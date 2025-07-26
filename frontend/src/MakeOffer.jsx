import React, { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import idl from './idl/swap_idl.json';

export const MakeOffer = () => {
  const { publicKey, wallet } = useWallet();
  const { connection } = useConnection();
  const [offerId, setOfferId] = useState('');
  const [tokenAAmount, setTokenAAmount] = useState('');
  const [tokenBAmount, setTokenBAmount] = useState('');
  const [tokenMintA, setTokenMintA] = useState('');
  const [tokenMintB, setTokenMintB] = useState('');
  const [makerTokenAccountA, setMakerTokenAccountA] = useState('');
  const [status, setStatus] = useState('');

  const handleMakeOffer = async () => {
    if (!publicKey || !wallet) {
      setStatus('Please connect your wallet.');
      return;
    }

    try {
      const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: 'confirmed',
      });
      const program = new anchor.Program(idl, provider);

      const offerIdBN = new anchor.BN(parseInt(offerId));
      const tokenAAmountBN = new anchor.BN(parseFloat(tokenAAmount) * 10 ** 9);
      const tokenBWantedAmountBN = new anchor.BN(parseFloat(tokenBAmount) * 10 ** 9);

      const [offerPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('offer'),
          publicKey.toBuffer(),
          offerIdBN.toArrayLike(Buffer, 'le', 8),
        ],
        new PublicKey(idl.address)
      );

      const vault = await anchor.web3.PublicKey.findProgramAddressSync(
        [new PublicKey(tokenMintA).toBuffer(), offerPda.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      )[0];

      const tx = await program.methods
        .makeOffer(offerIdBN, tokenAAmountBN, tokenBWantedAmountBN)
        .accounts({
          maker: publicKey,
          tokenMintA: new PublicKey(tokenMintA),
          tokenMintB: new PublicKey(tokenMintB),
          makerTokenAccountA: new PublicKey(makerTokenAccountA),
          offer: offerPda,
          vault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();

      setStatus(`Offer created: ${tx}`);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  return (
    <div className="make-offer">
      <h2>Make Offer</h2>
      <input
        type="text"
        placeholder="Offer ID"
        value={offerId}
        onChange={(e) => setOfferId(e.target.value)}
      />
      <input
        type="text"
        placeholder="Token A Mint Address"
        value={tokenMintA}
        onChange={(e) => setTokenMintA(e.target.value)}
      />
      <input
        type="text"
        placeholder="Token B Mint Address"
        value={tokenMintB}
        onChange={(e) => setTokenMintB(e.target.value)}
      />
      <input
        type="text"
        placeholder="Maker Token A Account"
        value={makerTokenAccountA}
        onChange={(e) => setMakerTokenAccountA(e.target.value)}
      />
      <input
        type="text"
        placeholder="Token A Amount"
        value={tokenAAmount}
        onChange={(e) => setTokenAAmount(e.target.value)}
      />
      <input
        type="text"
        placeholder="Token B Wanted Amount"
        value={tokenBAmount}
        onChange={(e) => setTokenBAmount(e.target.value)}
      />
      <button onClick={handleMakeOffer} disabled={!publicKey}>
        Make Offer
      </button>
      <p>{status}</p>
    </div>
  );
};