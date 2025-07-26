import React, { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import idl from './idl/swap_idl.json';

export const TakeOffer = () => {
  const { publicKey, wallet } = useWallet();
  const { connection } = useConnection();
  const [offerId, setOfferId] = useState('');
  const [maker, setMaker] = useState('');
  const [tokenMintA, setTokenMintA] = useState('');
  const [tokenMintB, setTokenMintB] = useState('');
  const [status, setStatus] = useState('');

  const handleTakeOffer = async () => {
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

      const [offerPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('offer'),
          new PublicKey(maker).toBuffer(),
          offerIdBN.toArrayLike(Buffer, 'le', 8),
        ],
        new PublicKey(idl.address)
      );

      const vault = await anchor.web3.PublicKey.findProgramAddressSync(
        [new PublicKey(tokenMintA).toBuffer(), offerPda.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      )[0];

      const takerTokenAccountA = await anchor.web3.PublicKey.findProgramAddressSync(
        [publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), new PublicKey(tokenMintA).toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      )[0];

      const takerTokenAccountB = await anchor.web3.PublicKey.findProgramAddressSync(
        [publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), new PublicKey(tokenMintB).toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      )[0];

      const makerTokenAccountB = await anchor.web3.PublicKey.findProgramAddressSync(
        [new PublicKey(maker).toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), new PublicKey(tokenMintB).toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      )[0];

      const tx = await program.methods
        .takeOffer()
        .accounts({
          taker: publicKey,
          maker: new PublicKey(maker),
          tokenMintA: new PublicKey(tokenMintA),
          tokenMintB: new PublicKey(tokenMintB),
          takerTokenAccountA,
          takerTokenAccountB,
          makerTokenAccountB,
          offer: offerPda,
          vault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();

      setStatus(`Offer taken: ${tx}`);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  return (
    <div className="take-offer">
      <h2>Take Offer</h2>
      <input
        type="text"
        placeholder="Offer ID"
        value={offerId}
        onChange={(e) => setOfferId(e.target.value)}
      />
      <input
        type="text"
        placeholder="Maker Public Key"
        value={maker}
        onChange={(e) => setMaker(e.target.value)}
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
      <button onClick={handleTakeOffer} disabled={!publicKey}>
        Take Offer
      </button>
      <p>{status}</p>
    </div>
  );
};