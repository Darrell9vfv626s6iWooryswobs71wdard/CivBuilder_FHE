// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Imports for homomorphic types and runtime integration
import { FHE, euint32, euint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title CivBuilderFHE
/// @notice Core on-chain primitives for encrypted civilization state management.
contract CivBuilderFHE is SepoliaConfig {
    // Identifier counter for player records
    uint256 public playerCounter;

    // Representation of an encrypted civilization snapshot
    struct EncryptedCiv {
        uint256 civId;
        address owner;
        euint64 encryptedResources;    // packed resources (e.g., food, wood, ore)
        euint32 encryptedTechState;    // bitset or packed tech tree progress
        euint32 encryptedMilitary;     // packed military units / strength
        euint32 encryptedPopulation;   // population metric
        uint256 submittedAt;
    }

    // Turn action submitted by a player (encrypted)
    struct EncryptedAction {
        uint256 actionId;
        uint256 civId;
        euint32 encryptedActionType;   // action code (build, research, attack)
        euint64 encryptedPayload;      // generic payload (amounts, targets)
        uint256 turnNumber;
        uint256 createdAt;
    }

    // Aggregated encrypted snapshot used for world-level metrics
    struct EncryptedWorldAgg {
        bytes32 aggKey;
        euint64 encryptedGlobalResources;
        euint32 encryptedActiveCivs;
        uint256 lastUpdated;
    }

    // Storage mappings
    mapping(uint256 => EncryptedCiv) public civilizations;
    mapping(address => uint256[]) public ownerCivs;
    mapping(uint256 => EncryptedAction[]) public civActions;

    mapping(bytes32 => EncryptedWorldAgg) private worldAggregates;
    bytes32[] private aggregateKeys;

    // Request tracking for FHE callbacks
    mapping(uint256 => bytes32) private requestToAggKey;
    mapping(uint256 => uint256) private requestToAction;
    mapping(uint256 => uint256) private requestToCiv;

    // Simple admin list for governance operations
    mapping(address => bool) public admins;

    // Events
    event CivSubmitted(uint256 indexed civId, address indexed owner, uint256 timestamp);
    event ActionSubmitted(uint256 indexed actionId, uint256 indexed civId, uint256 turn);
    event WorldAggregateUpdated(bytes32 indexed aggKey, uint256 timestamp);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed relatedId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed relatedId);

    // Modifiers
    modifier onlyAdmin() {
        require(admins[msg.sender], "not admin");
        _;
    }

    modifier onlyOwner(uint256 civId) {
        require(civilizations[civId].owner == msg.sender, "not owner");
        _;
    }

    // Constructor assigns deployer as admin
    constructor() {
        admins[msg.sender] = true;
    }

    // Admin management
    function addAdmin(address addr) public onlyAdmin {
        admins[addr] = true;
    }

    function removeAdmin(address addr) public onlyAdmin {
        admins[addr] = false;
    }

    /// @dev Submit an encrypted civilization snapshot
    function submitEncryptedCiv(
        euint64 encryptedResources,
        euint32 encryptedTechState,
        euint32 encryptedMilitary,
        euint32 encryptedPopulation
    ) public returns (uint256) {
        playerCounter += 1;
        uint256 cid = playerCounter;

        civilizations[cid] = EncryptedCiv({
            civId: cid,
            owner: msg.sender,
            encryptedResources: encryptedResources,
            encryptedTechState: encryptedTechState,
            encryptedMilitary: encryptedMilitary,
            encryptedPopulation: encryptedPopulation,
            submittedAt: block.timestamp
        });

        ownerCivs[msg.sender].push(cid);

        emit CivSubmitted(cid, msg.sender, block.timestamp);
        return cid;
    }

    /// @dev Submit an encrypted action for a civilization (turn-based)
    function submitEncryptedAction(
        uint256 civId,
        euint32 encryptedActionType,
        euint64 encryptedPayload,
        uint256 turnNumber
    ) public onlyOwner(civId) returns (uint256) {
        uint256 actionId = block.timestamp ^ civId ^ turnNumber;
        EncryptedAction memory a = EncryptedAction({
            actionId: actionId,
            civId: civId,
            encryptedActionType: encryptedActionType,
            encryptedPayload: encryptedPayload,
            turnNumber: turnNumber,
            createdAt: block.timestamp
        });

        civActions[civId].push(a);

        emit ActionSubmitted(actionId, civId, turnNumber);
        return actionId;
    }

    /// @dev Update or initialize a world-level encrypted aggregate
    function updateWorldAggregate(
        bytes32 aggKey,
        euint64 encryptedResourcesDelta,
        euint32 encryptedCivsDelta
    ) public onlyAdmin {
        EncryptedWorldAgg storage ag = worldAggregates[aggKey];

        if (ag.aggKey == bytes32(0)) {
            ag.aggKey = aggKey;
            ag.encryptedGlobalResources = FHE.asEuint64(0);
            ag.encryptedActiveCivs = FHE.asEuint32(0);
            aggregateKeys.push(aggKey);
        }

        ag.encryptedGlobalResources = FHE.add(ag.encryptedGlobalResources, encryptedResourcesDelta);
        ag.encryptedActiveCivs = FHE.add(ag.encryptedActiveCivs, encryptedCivsDelta);
        ag.lastUpdated = block.timestamp;

        worldAggregates[aggKey] = ag;

        emit WorldAggregateUpdated(aggKey, block.timestamp);
    }

    /// @dev Request decryption of a world aggregate for analysis
    function requestAggregateDecryption(bytes32 aggKey) public onlyAdmin {
        EncryptedWorldAgg storage ag = worldAggregates[aggKey];
        require(ag.aggKey != bytes32(0), "agg missing");

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(ag.encryptedGlobalResources);
        cts[1] = FHE.toBytes32(ag.encryptedActiveCivs);

        uint256 reqId = FHE.requestDecryption(cts, this.handleAggregateDecryption.selector);
        requestToAggKey[reqId] = aggKey;

        emit DecryptionRequested(reqId, uint256(uint160(msg.sender)));
    }

    /// @dev Callback invoked by FHE runtime with decrypted aggregate
    function handleAggregateDecryption(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        bytes32 aggKey = requestToAggKey[requestId];
        require(aggKey != bytes32(0), "invalid req");

        FHE.checkSignatures(requestId, cleartexts, proof);

        (uint64 totalResources, uint32 activeCivs) = abi.decode(cleartexts, (uint64, uint32));

        // Post-processing or governance logic can be placed off-chain.
        // Emitting an event to signal completion without storing plaintext.
        emit DecryptionCompleted(requestId, uint256(bytes32ToUint(aggKey)));
    }

    /// @dev Request decryption of a specific action (owner-only)
    function requestActionDecryption(uint256 civId, uint256 actionIndex) public {
        require(actionIndex < civActions[civId].length, "index OOB");
        EncryptedAction storage a = civActions[civId][actionIndex];
        require(civilizations[civId].owner == msg.sender, "not owner");

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(a.encryptedActionType);
        cts[1] = FHE.toBytes32(a.encryptedPayload);

        uint256 reqId = FHE.requestDecryption(cts, this.handleActionDecryption.selector);
        requestToAction[reqId] = a.actionId;

        emit DecryptionRequested(reqId, a.actionId);
    }

    /// @dev Callback for decrypted action values
    function handleActionDecryption(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        uint256 actionId = requestToAction[requestId];
        require(actionId != 0, "invalid req");

        FHE.checkSignatures(requestId, cleartexts, proof);

        (uint32 actionType, uint64 payload) = abi.decode(cleartexts, (uint32, uint64));

        emit DecryptionCompleted(requestId, actionId);
    }

    /// @dev Request decryption of own civilization snapshot
    function requestCivDecryption(uint256 civId) public onlyOwner(civId) {
        EncryptedCiv storage c = civilizations[civId];

        bytes32[] memory cts = new bytes32[](4);
        cts[0] = FHE.toBytes32(c.encryptedResources);
        cts[1] = FHE.toBytes32(c.encryptedTechState);
        cts[2] = FHE.toBytes32(c.encryptedMilitary);
        cts[3] = FHE.toBytes32(c.encryptedPopulation);

        uint256 reqId = FHE.requestDecryption(cts, this.handleCivDecryption.selector);
        requestToCiv[reqId] = civId;

        emit DecryptionRequested(reqId, civId);
    }

    /// @dev Callback for decrypted civilization snapshot
    function handleCivDecryption(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        uint256 civId = requestToCiv[requestId];
        require(civId != 0, "invalid req");

        FHE.checkSignatures(requestId, cleartexts, proof);

        (uint64 resources, uint32 techState, uint32 military, uint32 population) = abi.decode(cleartexts, (uint64, uint32, uint32, uint32));

        emit DecryptionCompleted(requestId, civId);
    }

    // Read helpers

    function getOwnerCivs(address owner) public view returns (uint256[] memory) {
        return ownerCivs[owner];
    }

    function getCiv(uint256 civId) public view returns (
        address owner,
        euint64 encryptedResources,
        euint32 encryptedTechState,
        euint32 encryptedMilitary,
        euint32 encryptedPopulation,
        uint256 submittedAt
    ) {
        EncryptedCiv storage c = civilizations[civId];
        return (c.owner, c.encryptedResources, c.encryptedTechState, c.encryptedMilitary, c.encryptedPopulation, c.submittedAt);
    }

    function listAggregates() public view returns (bytes32[] memory) {
        return aggregateKeys;
    }

    function getAggregate(bytes32 aggKey) public view returns (euint64, euint32, uint256) {
        EncryptedWorldAgg storage ag = worldAggregates[aggKey];
        return (ag.encryptedGlobalResources, ag.encryptedActiveCivs, ag.lastUpdated);
    }

    // Utility and housekeeping

    function bytes32ToUint(bytes32 b) internal pure returns (uint256) {
        return uint256(b);
    }

    function asEuint64(uint64 v) public pure returns (euint64) {
        return FHE.asEuint64(v);
    }

    function asEuint32(uint32 v) public pure returns (euint32) {
        return FHE.asEuint32(v);
    }

    // Admin cleanup for aggregates
    function adminRemoveAggregate(bytes32 aggKey) public onlyAdmin {
        delete worldAggregates[aggKey];
        for (uint i = 0; i < aggregateKeys.length; i++) {
            if (aggregateKeys[i] == aggKey) {
                aggregateKeys[i] = aggregateKeys[aggregateKeys.length - 1];
                aggregateKeys.pop();
                break;
            }
        }
    }

    // Fallbacks
    receive() external payable {}
    fallback() external payable {}
}
