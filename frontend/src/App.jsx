import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, Link } from 'react-router-dom';
import { WalletContext } from './WalletContext';
import { Setup } from './SetUp';
import { MakeOffer } from './MakeOffer';
import { TakeOffer } from './TakeOffer';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { ArrowLeft, Coins, Settings, Plus, ShoppingCart } from 'lucide-react';

const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isSubPage = ['/setup', '/make-offer', '/take-offer'].includes(location.pathname);

  if (isSubPage) {
    return (
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors duration-200"
      >
        <ArrowLeft size={18} />
        Back to Home
      </button>
    );
  }

  return null; // No buttons on home page
};

const HomePage = () => {
  return (
    <div className="max-w-4xl mx-auto text-center">
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mb-6">
          <Coins size={40} className="text-white" />
        </div>
        <h2 className="text-3xl font-bold text-gray-800 mb-4">Welcome to Solana Token Swap</h2>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto leading-relaxed">
          A decentralized platform for creating and trading token offers on the Solana blockchain.
          Create your own tokens, make offers, and participate in peer-to-peer token swaps.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        <a href="/setup">
          <div className="bg-white p-6 rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow duration-200 flex flex-col justify-between min-h-[200px]">
            <div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4 mx-auto">
                <Settings size={24} className="text-blue-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-800 mb-2">Setup Tokens</h3>
              <p className="text-gray-600 text-sm">
                Create custom SPL tokens with metadata and mint them to your wallet for trading.
              </p>
            </div>
          </div>
        </a>

        <a href="/make-offer">
          <div className="bg-white p-6 rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow duration-200 flex flex-col justify-between min-h-[200px]">
            <div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4 mx-auto">
                <Plus size={24} className="text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-800 mb-2">Make Offer</h3>
              <p className="text-gray-600 text-sm">
                Create token swap offers by specifying the tokens and amounts you want to trade.
              </p>
            </div>
          </div>
        </a>

        <a href="/take-offer">
          <div className="bg-white p-6 rounded-xl shadow-md border border-gray-100 hover:shadow-lg transition-shadow duration-200 flex flex-col justify-between min-h-[200px]">
            <div>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4 mx-auto">
                <ShoppingCart size={24} className="text-purple-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-800 mb-2">Take Offer</h3>
              <p className="text-gray-600 text-sm">
                Browse and accept token swap offers from other users to exchange tokens.
              </p>
            </div>
          </div>
        </a>
      </div>

      <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-xl border border-blue-100">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">Getting Started</h3>
        <p className="text-gray-600">
          Connect your Solana wallet and start by setting up your tokens. Make sure you have some SOL for transaction fees.
        </p>
      </div>
    </div>
  );
};

const Header = () => {
  const location = useLocation();
  const isSubPage = ['/setup', '/make-offer', '/take-offer'].includes(location.pathname);

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-4">
          <div className="flex items-center gap-3">
            {/* Show logo and text on home page for all sizes, and on sub-pages only for non-mobile (sm and above) */}
            <div className={`${isSubPage ? 'hidden sm:flex' : 'flex'} items-center gap-3`}>
              <Link to="/" className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <Coins size={24} className="text-white" />
                </div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                  Solana Token Swap
                </h1>
              </Link>
            </div>
            {/* Show Back to Home button on mobile for sub-pages */}
            {isSubPage && (
              <div className="sm:hidden">
                <Navigation />
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            {/* Show Navigation on non-mobile for sub-pages, and not at all on home page */}
            <div className="hidden sm:block">
              <Navigation />
            </div>
            <div className="wallet-button-container">
              <WalletMultiButton />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export const App = () => {
  return (
    <WalletContext>
      <Router>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
          <Header />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <Routes>
              <Route path="/setup" element={<Setup />} />
              <Route path="/make-offer" element={<MakeOffer />} />
              <Route path="/take-offer" element={<TakeOffer />} />
              <Route path="/" element={<HomePage />} />
              <Route path="*" element={<HomePage />} />
            </Routes>
          </main>
          <footer className="bg-white border-t border-gray-200 mt-16">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <div className="text-center text-gray-500 text-sm">
                <p>Built on Solana • Powered by Anchor Framework</p>
              </div>
            </div>
          </footer>
        </div>
      </Router>
    </WalletContext>
  );
};

export default App;