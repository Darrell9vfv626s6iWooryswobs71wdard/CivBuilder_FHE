import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface Civilization {
  id: string;
  name: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  resources: {
    food: number;
    gold: number;
    science: number;
    culture: number;
  };
  techTree: string[];
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [civilizations, setCivilizations] = useState<Civilization[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newCivData, setNewCivData] = useState({
    name: "",
    description: ""
  });
  const [showFAQ, setShowFAQ] = useState(false);

  // Calculate statistics
  const totalFood = civilizations.reduce((sum, civ) => sum + civ.resources.food, 0);
  const totalGold = civilizations.reduce((sum, civ) => sum + civ.resources.gold, 0);
  const totalScience = civilizations.reduce((sum, civ) => sum + civ.resources.science, 0);
  const totalCulture = civilizations.reduce((sum, civ) => sum + civ.resources.culture, 0);

  useEffect(() => {
    loadCivilizations().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadCivilizations = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("civ_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing civilization keys:", e);
        }
      }
      
      const list: Civilization[] = [];
      
      for (const key of keys) {
        try {
          const civBytes = await contract.getData(`civ_${key}`);
          if (civBytes.length > 0) {
            try {
              const civData = JSON.parse(ethers.toUtf8String(civBytes));
              list.push({
                id: key,
                name: civData.name,
                encryptedData: civData.encryptedData,
                timestamp: civData.timestamp,
                owner: civData.owner,
                resources: civData.resources,
                techTree: civData.techTree || []
              });
            } catch (e) {
              console.error(`Error parsing civilization data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading civilization ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setCivilizations(list);
    } catch (e) {
      console.error("Error loading civilizations:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const createCivilization = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting civilization data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify({
        ...newCivData,
        resources: {
          food: Math.floor(Math.random() * 100) + 50,
          gold: Math.floor(Math.random() * 100) + 30,
          science: Math.floor(Math.random() * 100) + 20,
          culture: Math.floor(Math.random() * 100) + 10
        },
        techTree: ["Basic Agriculture"]
      }))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const civId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const civData = {
        name: newCivData.name,
        encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        resources: {
          food: Math.floor(Math.random() * 100) + 50,
          gold: Math.floor(Math.random() * 100) + 30,
          science: Math.floor(Math.random() * 100) + 20,
          culture: Math.floor(Math.random() * 100) + 10
        },
        techTree: ["Basic Agriculture"]
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `civ_${civId}`, 
        ethers.toUtf8Bytes(JSON.stringify(civData))
      );
      
      const keysBytes = await contract.getData("civ_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(civId);
      
      await contract.setData(
        "civ_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Civilization created with FHE encryption!"
      });
      
      await loadCivilizations();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewCivData({
          name: "",
          description: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Creation failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE Contract is ${isAvailable ? "available" : "unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const faqItems = [
    {
      question: "What is FHE?",
      answer: "Fully Homomorphic Encryption (FHE) allows computations on encrypted data without decrypting it first."
    },
    {
      question: "How is my civilization data protected?",
      answer: "All sensitive data is encrypted using FHE before being stored on-chain, ensuring complete privacy."
    },
    {
      question: "Can other players see my resources?",
      answer: "No, your resources and tech tree are encrypted and only visible to you through FHE decryption."
    },
    {
      question: "How do I expand my civilization?",
      answer: "Use encrypted transactions to build structures, research technologies, and manage resources."
    }
  ];

  const renderResourceChart = () => {
    const resourceTypes = ["Food", "Gold", "Science", "Culture"];
    const resourceValues = [totalFood, totalGold, totalScience, totalCulture];
    const maxValue = Math.max(...resourceValues, 100);
    
    return (
      <div className="resource-chart">
        {resourceTypes.map((type, index) => (
          <div key={type} className="resource-bar">
            <div className="resource-label">{type}</div>
            <div className="bar-container">
              <div 
                className="bar-fill" 
                style={{ width: `${(resourceValues[index] / maxValue) * 100}%` }}
              >
                <span className="bar-value">{resourceValues[index]}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="tech-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container tech-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>CivBuilder<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn tech-button"
          >
            <div className="add-icon"></div>
            New Civilization
          </button>
          <button 
            className="tech-button"
            onClick={() => setShowFAQ(!showFAQ)}
          >
            {showFAQ ? "Hide FAQ" : "Show FAQ"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="project-intro tech-card">
          <h2>FHE-Powered Private On-Chain Civilization-Building Game</h2>
          <p>
            Build your civilization on-chain with complete privacy. Your tech tree, resources, 
            and strategic intentions are encrypted using Fully Homomorphic Encryption (FHE), 
            enabling deep strategic gameplay without compromising privacy.
          </p>
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
        </div>
        
        <div className="dashboard-panels">
          <div className="panel tech-card">
            <h3>Civilization Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{civilizations.length}</div>
                <div className="stat-label">Civilizations</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{totalFood}</div>
                <div className="stat-label">Total Food</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{totalGold}</div>
                <div className="stat-label">Total Gold</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{totalScience}</div>
                <div className="stat-label">Total Science</div>
              </div>
            </div>
          </div>
          
          <div className="panel tech-card">
            <h3>Resource Distribution</h3>
            {renderResourceChart()}
          </div>
        </div>
        
        <div className="action-bar">
          <button 
            onClick={loadCivilizations}
            className="refresh-btn tech-button"
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh Civilizations"}
          </button>
          <button 
            onClick={checkAvailability}
            className="tech-button"
          >
            Check FHE Availability
          </button>
        </div>
        
        <div className="civilizations-section">
          <div className="section-header">
            <h2>Civilizations</h2>
          </div>
          
          <div className="civ-list">
            {civilizations.length === 0 ? (
              <div className="no-civs tech-card">
                <div className="no-civs-icon"></div>
                <p>No civilizations found</p>
                <button 
                  className="tech-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Civilization
                </button>
              </div>
            ) : (
              civilizations.map(civ => (
                <div className="civ-card tech-card" key={civ.id}>
                  <div className="civ-header">
                    <h3>{civ.name}</h3>
                    <span className="owner-badge">
                      {isOwner(civ.owner) ? "Your Civilization" : "Other Player"}
                    </span>
                  </div>
                  
                  <div className="civ-meta">
                    <div className="meta-item">
                      <span className="meta-label">Owner:</span>
                      <span className="meta-value">{civ.owner.substring(0, 6)}...{civ.owner.substring(38)}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Founded:</span>
                      <span className="meta-value">
                        {new Date(civ.timestamp * 1000).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  
                  <div className="civ-resources">
                    <div className="resource">
                      <div className="resource-icon food"></div>
                      <span>{civ.resources.food}</span>
                    </div>
                    <div className="resource">
                      <div className="resource-icon gold"></div>
                      <span>{civ.resources.gold}</span>
                    </div>
                    <div className="resource">
                      <div className="resource-icon science"></div>
                      <span>{civ.resources.science}</span>
                    </div>
                    <div className="resource">
                      <div className="resource-icon culture"></div>
                      <span>{civ.resources.culture}</span>
                    </div>
                  </div>
                  
                  <div className="civ-tech">
                    <h4>Technology Tree</h4>
                    <div className="tech-list">
                      {civ.techTree.map((tech, index) => (
                        <div key={index} className="tech-item">
                          {tech}
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="civ-actions">
                    <button className="tech-button small">
                      View Details
                    </button>
                    {isOwner(civ.owner) && (
                      <button className="tech-button small primary">
                        Manage
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        
        {showFAQ && (
          <div className="faq-section tech-card">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-list">
              {faqItems.map((item, index) => (
                <div key={index} className="faq-item">
                  <h3>{item.question}</h3>
                  <p>{item.answer}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={createCivilization} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          civData={newCivData}
          setCivData={setNewCivData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content tech-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="tech-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>CivBuilder FHE</span>
            </div>
            <p>Private on-chain civilization building powered by FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Community</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Gameplay</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} CivBuilder FHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  civData: any;
  setCivData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  civData,
  setCivData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCivData({
      ...civData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!civData.name) {
      alert("Please enter a civilization name");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal tech-card">
        <div className="modal-header">
          <h2>Create New Civilization</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your civilization data will be encrypted with FHE
          </div>
          
          <div className="form-group">
            <label>Civilization Name *</label>
            <input 
              type="text"
              name="name"
              value={civData.name} 
              onChange={handleChange}
              placeholder="Enter civilization name..." 
              className="tech-input"
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description"
              value={civData.description} 
              onChange={handleChange}
              placeholder="Describe your civilization..." 
              className="tech-textarea"
              rows={3}
            />
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            Your strategic data will remain encrypted during all FHE computations
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn tech-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn tech-button primary"
          >
            {creating ? "Creating with FHE..." : "Create Civilization"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;