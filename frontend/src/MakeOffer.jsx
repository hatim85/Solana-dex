import React, { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import idl from './idl/swap_idl.json';
import { getAccount } from '@solana/spl-token';

export const MakeOffer = () => {
  const { publicKey, wallet } = useWallet();
  const { connection } = useConnection();
  const [offerId, setOfferId] = useState('1');
  const [tokenAAmount, setTokenAAmount] = useState('10');
  const [tokenBAmount, setTokenBAmount] = useState('10');
  const [tokenMintA, setTokenMintA] = useState('44FVk1YwWgqbEosWBXjn91P5wysJSPBwhcACQESACpEB');
  const [tokenMintB, setTokenMintB] = useState('GcsFbKXL4rzshrpDaj9DhxcT5GiAR4qgzjX4hP3EK21s');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validatePublicKey = (key, context) => {
    try {
      new PublicKey(key);
      return true;
    } catch (error) {
      console.error(`Invalid public key in ${context}:`, { key, error });
      return false;
    }
  };

  const handleMakeOffer = async () => {
    if (isSubmitting) return; // Prevent multiple submissions
    setIsSubmitting(true);
    console.log('handleMakeOffer started', { publicKey: publicKey?.toBase58(), wallet: !!wallet, adapter: !!wallet?.adapter });

    if (!publicKey || !wallet || !wallet.adapter) {
      setStatus('Please connect your wallet.');
      console.log('Wallet not connected, exiting');
      return;
    }

    try {
      setStatus('Creating offer...');
      console.log('Starting offer creation process...');

      // Validate inputs
      const offerIdNum = parseInt(offerId);
      const tokenAAmountNum = parseFloat(tokenAAmount);
      const tokenBAmountNum = parseFloat(tokenBAmount);

      if (isNaN(offerIdNum) || offerIdNum < 0) {
        setStatus('Invalid Offer ID. Must be a non-negative integer.');
        console.log('Invalid Offer ID', { offerId });
        return;
      }
      if (isNaN(tokenAAmountNum) || tokenAAmountNum <= 0) {
        setStatus('Invalid Token A amount. Must be a positive number.');
        console.log('Invalid Token A amount', { tokenAAmount });
        return;
      }
      if (isNaN(tokenBAmountNum) || tokenBAmountNum <= 0) {
        setStatus('Invalid Token B amount. Must be a positive number.');
        console.log('Invalid Token B amount', { tokenBAmount });
        return;
      }
      if (!validatePublicKey(tokenMintA, 'Token A Mint')) {
        setStatus('Invalid Token A Mint address.');
        console.log('Invalid Token A Mint', { tokenMintA });
        return;
      }
      if (!validatePublicKey(tokenMintB, 'Token B Mint')) {
        setStatus('Invalid Token B Mint address.');
        console.log('Invalid Token B Mint', { tokenMintB });
        return;
      }

      // Derive Maker Token A Account
      const makerTokenAccountA = await getAssociatedTokenAddress(
        new PublicKey(tokenMintA),
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log('Derived Maker Token A Account:', makerTokenAccountA.toBase58());

      // Derive Maker Token B Account
      const makerTokenAccountB = await getAssociatedTokenAddress(
        new PublicKey(tokenMintB),
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log('Derived Maker Token B Account:', makerTokenAccountB.toBase58());

      // Check SOL balance
      console.log('Checking wallet SOL balance...');
      const balance = await connection.getBalance(publicKey);
      console.log('Wallet SOL balance:', balance / anchor.web3.LAMPORTS_PER_SOL);
      const minSolRequired = 0.005 * anchor.web3.LAMPORTS_PER_SOL; // ~0.005 SOL for transaction
      if (balance < minSolRequired) {
        setStatus(`Insufficient SOL balance. Need at least ${minSolRequired / anchor.web3.LAMPORTS_PER_SOL} SOL.`);
        console.log('Insufficient SOL balance', { balance: balance / anchor.web3.LAMPORTS_PER_SOL });
        return;
      }

      // Initialize Anchor provider
      const provider = new anchor.AnchorProvider(connection, wallet.adapter, {
        commitment: 'confirmed',
      });
      const programId = new PublicKey(idl.address);
      const program = new anchor.Program(idl, provider);

      // Convert inputs
      const offerIdBN = new anchor.BN(offerIdNum);
      const tokenAAmountBN = new anchor.BN(tokenAAmountNum * 10 ** 9);
      const tokenBWantedAmountBN = new anchor.BN(tokenBAmountNum * 10 ** 9);
      console.log('Input values', { offerIdBN: offerIdBN.toString(), tokenAAmountBN: tokenAAmountBN.toString(), tokenBWantedAmountBN: tokenBWantedAmountBN.toString() });

      // Derive offer PDA
      const [offerPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('offer'),
          publicKey.toBuffer(),
          offerIdBN.toArrayLike(Buffer, 'le', 8),
        ],
        programId
      );
      console.log('Derived offer PDA:', offerPda.toBase58());

      // Derive vault ATA
      const vault = await getAssociatedTokenAddress(
        new PublicKey(tokenMintA),  // The mint of the tokens this vault will hold
        offerPda,                   // The owner of this ATA is the offer PDA
        true,                       // Set to true because offerPda is a PDA (off-curve)
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log('Derived vault ATA (corrected):', vault.toBase58());

      // Verify accounts exist
      const tokenMintAInfo = await connection.getAccountInfo(new PublicKey(tokenMintA));
      if (!tokenMintAInfo) {
        setStatus('Token A Mint does not exist.');
        console.log('Token A Mint not found', { tokenMintA });
        return;
      }
      const tokenMintBInfo = await connection.getAccountInfo(new PublicKey(tokenMintB));
      if (!tokenMintBInfo) {
        setStatus('Token B Mint does not exist.');
        console.log('Token B Mint not found', { tokenMintB });
        return;
      }
      const makerTokenAccountAInfo = await connection.getAccountInfo(makerTokenAccountA);
      if (!makerTokenAccountAInfo) {
        setStatus('Maker Token A Account does not exist.');
        console.log('Maker Token A Account not found', { makerTokenAccountA: makerTokenAccountA.toBase58() });
        return;
      }
      const makerTokenAccountBInfo = await connection.getAccountInfo(makerTokenAccountB);
      if (!makerTokenAccountBInfo) {
        setStatus('Maker Token B Account does not exist.');
        console.log('Maker Token B Account not found', { makerTokenAccountB: makerTokenAccountB.toBase58() });
        return;
      }
      // Verify makerTokenAccountA is owned by Token Program
      if (!makerTokenAccountAInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        setStatus('Maker Token A Account is not owned by the Token Program.');
        console.log('Maker Token A Account has incorrect owner', {
          makerTokenAccountA: makerTokenAccountA.toBase58(),
          owner: makerTokenAccountAInfo.owner.toBase58(),
          expected: TOKEN_PROGRAM_ID.toBase58(),
        });
        return;
      }
      // Verify makerTokenAccountB is owned by Token Program
      if (!makerTokenAccountBInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        setStatus('Maker Token B Account is not owned by the Token Program.');
        console.log('Maker Token B Account has incorrect owner', {
          makerTokenAccountB: makerTokenAccountB.toBase58(),
          owner: makerTokenAccountBInfo.owner.toBase58(),
          expected: TOKEN_PROGRAM_ID.toBase58(),
        });
        return;
      }
      const tokenAccountAData = await getAccount(connection, makerTokenAccountA);
      if (!tokenAccountAData.mint.equals(new PublicKey(tokenMintA))) {
        setStatus('Maker Token A Account is not associated with Token A Mint.');
        console.log('Maker Token A Account mint mismatch', {
          tokenAccountMint: tokenAccountAData.mint.toBase58(),
          expectedMint: tokenMintA,
        });
        return;
      }
      const tokenAccountBData = await getAccount(connection, makerTokenAccountB);
      if (!tokenAccountBData.mint.equals(new PublicKey(tokenMintB))) {
        setStatus('Maker Token B Account is not associated with Token B Mint.');
        console.log('Maker Token B Account mint mismatch', {
          tokenAccountMint: tokenAccountBData.mint.toBase58(),
          expectedMint: tokenMintB,
        });
        return;
      }
      // Verify sufficient balance for Token A
      const tokenAAmountLamports = tokenAAmountNum * 10 ** 9;
      if (tokenAccountAData.amount < BigInt(tokenAAmountLamports)) {
        setStatus(`Insufficient balance in Maker Token A Account. Need ${tokenAAmountNum} tokens.`);
        console.log('Insufficient balance in Token A', {
          available: Number(tokenAccountAData.amount) / 10 ** 9,
          required: tokenAAmountNum,
        });
        return;
      }

      // Build and send transaction
      const tx = await program.methods
        .makeOffer(offerIdBN, tokenAAmountBN, tokenBWantedAmountBN)
        .accounts({
          maker: publicKey,
          tokenMintA: new PublicKey(tokenMintA),
          tokenMintB: new PublicKey(tokenMintB),
          makerTokenAccountA: makerTokenAccountA,
          makerTokenAccountB: makerTokenAccountB,
          offer: offerPda,
          vault: vault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      console.log('Offer transaction sent', { signature: tx });
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      await connection.confirmTransaction({ signature: tx, blockhash, lastValidBlockHeight }, 'confirmed');
      console.log('Offer transaction confirmed');

      setStatus(`Offer created successfully: ${tx}`);
    } catch (error) {
      setStatus(`Error: ${error.message || 'An unexpected error occurred.'}`);
      console.error('Error in handleMakeOffer:', error);
      if (error.stack) console.error('Stack trace:', error.stack);
      if (error instanceof anchor.AnchorError) {
        console.error('Anchor Error Details:', {
          errorCode: error.errorCode,
          errorMessage: error.errorMessage,
          program: error.program.toBase58(),
          logs: error.logs,
        });
      }
    } finally {
        setIsSubmitting(false); // Re-enable button after completion (success or error)
    }
  };

  return (
    <div className="make-offer">
      <h2>Make Offer</h2>
      <input
        type="number"
        placeholder="Offer ID"
        value={offerId}
        onChange={(e) => setOfferId(e.target.value)}
        min="0"
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
        type="number"
        placeholder="Token A Amount"
        value={tokenAAmount}
        onChange={(e) => setTokenAAmount(e.target.value)}
        min="0"
        step="0.01"
      />
      <input
        type="number"
        placeholder="Token B Wanted Amount"
        value={tokenBAmount}
        onChange={(e) => setTokenBAmount(e.target.value)}
        min="0"
        step="0.01"
      />
      <button onClick={handleMakeOffer} disabled={!publicKey || !wallet || !wallet.adapter || isSubmitting}>
        Make Offer
      </button>
      <p>{status}</p>
    </div>
  );
};