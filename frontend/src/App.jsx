import React from 'react';
import { WalletContext } from './WalletContext';
import { Setup } from './SetUp'; // Add this import
import { MakeOffer } from './MakeOffer';
import { TakeOffer } from './TakeOffer';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export const App = () => {
  return (
    <WalletContext>
      <div className="app">
        <header>
          <h1>Solana Token Swap</h1>
          <WalletMultiButton />
        </header>
        <main>
          <Setup /> {/* Add Setup component */}
          <MakeOffer />
          <TakeOffer />
        </main>
      </div>
    </WalletContext>
  );
};

export default App;