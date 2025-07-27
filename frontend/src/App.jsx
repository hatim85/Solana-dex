import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { WalletContext } from './WalletContext';
import { Setup } from './SetUp';
import { MakeOffer } from './MakeOffer';
import { TakeOffer } from './TakeOffer';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isSubPage = ['/setup', '/make-offer', '/take-offer'].includes(location.pathname);

  return (
    <nav>
      {isSubPage ? (
        <button onClick={() => navigate('/')}>Back</button>
      ) : (
        <>
          <Link to="/setup"><button>Setup Tokens</button></Link>
          <Link to="/make-offer"><button>Make Offer</button></Link>
          <Link to="/take-offer"><button>Take Offer</button></Link>
        </>
      )}
    </nav>
  );
};

export const App = () => {
  return (
    <WalletContext>
      <Router>
        <div className="app">
          <header>
            <h1>Solana Token Swap</h1>
            <WalletMultiButton />
            <Navigation />
          </header>
          <main>
            <Routes>
              <Route path="/setup" element={<Setup />} />
              <Route path="/make-offer" element={<MakeOffer />} />
              <Route path="/take-offer" element={<TakeOffer />} />
              <Route path="/" element={<div>Select an action above.</div>} />
              <Route path="*" element={<div>Select an action above.</div>} />
            </Routes>
          </main>
        </div>
      </Router>
    </WalletContext>
  );
};

export default App;