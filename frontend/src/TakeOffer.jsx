import React, { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import idl from './idl/swap_idl.json';

export const TakeOffer = () => {
  const { publicKey, wallet, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [offerId, setOfferId] = useState('2');
  const [maker, setMaker] = useState('DbYm9TtcrGwG5FVeV9prWr3ku6rA6ARfNRPe1hJsxwRZ');
  const [tokenMintA, setTokenMintA] = useState('44FVk1YwWgqbEosWBXjn91P5wysJSPBwhcACQESACpEB');
  const [tokenMintB, setTokenMintB] = useState('GcsFbKXL4rzshrpDaj9DhxcT5GiAR4qgzjX4hP3EK21s');
  const [status, setStatus] = useState('');

  const validatePublicKey = (key, context) => {
    try {
      new PublicKey(key);
      return true;
    } catch (error) {
      console.error(`Invalid public key in ${context}:`, { key, error });
      return false;
    }
  };

  const createTakerTokenAAccount = async () => {
    if (!publicKey || !wallet || !signTransaction) {
      setStatus('Please connect your wallet to create Token A account.');
      console.log('Wallet not connected or signTransaction missing');
      return;
    }

    try {
      setStatus('Creating Taker Token A Account...');
      console.log('Starting Token A ATA creation process...');

      const tokenMintAPubkey = new PublicKey(tokenMintA);
      const takerTokenAccountA = await getAssociatedTokenAddress(
        tokenMintAPubkey,
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log('Derived taker Token A Account for creation:', takerTokenAccountA.toBase58());

      // Check if ATA already exists
      const takerTokenAccountAInfo = await connection.getAccountInfo(takerTokenAccountA);
      if (takerTokenAccountAInfo) {
        setStatus('Taker Token A Account already exists.');
        console.log('Taker Token A Account already exists:', takerTokenAccountA.toBase58());
        return;
      }

      // Create transaction to initialize ATA
      const transaction = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          publicKey, // Payer (taker)
          takerTokenAccountA, // ATA address
          publicKey, // Owner (taker)
          tokenMintAPubkey, // Mint
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );

      // Get latest blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Sign and send transaction
      const signedTx = await signTransaction(transaction);
      const txSignature = await connection.sendRawTransaction(signedTx.serialize());
      console.log('Token A ATA creation transaction sent:', { signature: txSignature });

      // Confirm transaction
      await connection.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, 'confirmed');
      console.log('Token A ATA creation transaction confirmed');

      setStatus(`Taker Token A Account created successfully: ${txSignature}`);
      return takerTokenAccountA;
    } catch (error) {
      setStatus(`Error creating Token A Account: ${error.message || 'An unexpected error occurred.'}`);
      console.error('Error in createTakerTokenAAccount:', error);
      if (error.stack) console.error('Stack trace:', error.stack);
    }
  };

  const handleTakeOffer = async () => {
    console.log('handleTakeOffer started', { publicKey: publicKey?.toBase58(), wallet: !!wallet, signTransaction: !!signTransaction });

    if (!publicKey || !wallet || !signTransaction) {
      setStatus('Please connect your wallet.');
      console.log('Wallet not connected or signTransaction missing, exiting');
      return;
    }

    try {
      setStatus('Taking offer...');
      console.log('Starting offer taking process...');

      // Validate inputs
      const offerIdNum = parseInt(offerId);
      if (isNaN(offerIdNum) || offerIdNum < 0) {
        setStatus('Invalid Offer ID. Must be a non-negative integer.');
        console.log('Invalid Offer ID', { offerId });
        return;
      }
      if (!validatePublicKey(maker, 'Maker Public Key')) {
        setStatus('Invalid Maker Public Key.');
        console.log('Invalid Maker Public Key', { maker });
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

      // Initialize Anchor provider with custom wallet
      const anchorWallet = {
        publicKey,
        signTransaction,
        signAllTransactions: wallet.signAllTransactions,
      };
      const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: 'confirmed',
      });
      const programId = new PublicKey(idl.address);
      const program = new anchor.Program(idl, provider);

      // Convert inputs
      const offerIdBN = new anchor.BN(offerIdNum);
      console.log('Input values', { offerIdBN: offerIdBN.toString() });

      // Derive offer PDA
      const [offerPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('offer'),
          new PublicKey(maker).toBuffer(),
          offerIdBN.toArrayLike(Buffer, 'le', 8),
        ],
        programId
      );
      console.log('Derived offer PDA:', offerPda.toBase58());

      // Derive vault ATA
      const vault = await getAssociatedTokenAddress(
        new PublicKey(tokenMintA),
        offerPda,
        true, // Allow owner off-curve (PDA)
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log('Derived vault ATA:', vault.toBase58());

      // Derive taker token accounts
      const takerTokenAccountA = await getAssociatedTokenAddress(
        new PublicKey(tokenMintA),
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log('Derived taker Token A Account:', takerTokenAccountA.toBase58());

      const takerTokenAccountB = await getAssociatedTokenAddress(
        new PublicKey(tokenMintB),
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log('Derived taker Token B Account:', takerTokenAccountB.toBase58());

      const makerTokenAccountB = await getAssociatedTokenAddress(
        new PublicKey(tokenMintB),
        new PublicKey(maker),
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      console.log('Derived maker Token B Account:', makerTokenAccountB.toBase58());

      // Verify accounts exist
      const offerPdaInfo = await connection.getAccountInfo(offerPda);
      if (!offerPdaInfo) {
        setStatus('Offer PDA does not exist.');
        console.log('Offer PDA not found', { offerPda: offerPda.toBase58() });
        return;
      }
      const vaultInfo = await connection.getAccountInfo(vault);
      if (!vaultInfo) {
        setStatus('Vault ATA does not exist.');
        console.log('Vault ATA not found', { vault: vault.toBase58() });
        return;
      }
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

      console.log("takerTokenAccountA:", takerTokenAccountA.toBase58());
      const takerTokenAccountAInfo = await connection.getAccountInfo(takerTokenAccountA);
      console.log('Taker Token A Account info:', takerTokenAccountAInfo);
      if (!takerTokenAccountAInfo) {
        setStatus('Taker Token A Account does not exist. Please create it first.');
        console.log('Taker Token A Account not found', { takerTokenAccountA: takerTokenAccountA.toBase58() });
        return;
      }
      const takerTokenAccountBInfo = await connection.getAccountInfo(takerTokenAccountB);
      if (!takerTokenAccountBInfo) {
        setStatus('Taker Token B Account does not exist.');
        console.log('Taker Token B Account not found', { takerTokenAccountB: takerTokenAccountB.toBase58() });
        return;
      }
      const makerTokenAccountBInfo = await connection.getAccountInfo(makerTokenAccountB);
      if (!makerTokenAccountBInfo) {
        setStatus('Maker Token B Account does not exist.');
        console.log('Maker Token B Account not found', { makerTokenAccountB: makerTokenAccountB.toBase58() });
        return;
      }

      // Verify account ownership
      if (!vaultInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        setStatus('Vault ATA is not owned by the Token Program.');
        console.log('Vault ATA has incorrect owner', {
          vault: vault.toBase58(),
          owner: vaultInfo.owner.toBase58(),
          expected: TOKEN_PROGRAM_ID.toBase58(),
        });
        return;
      }
      if (!takerTokenAccountAInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        setStatus('Taker Token A Account is not owned by the Token Program.');
        console.log('Taker Token A Account has incorrect owner', {
          takerTokenAccountA: takerTokenAccountA.toBase58(),
          owner: takerTokenAccountAInfo.owner.toBase58(),
          expected: TOKEN_PROGRAM_ID.toBase58(),
        });
        return;
      }
      if (!takerTokenAccountBInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        setStatus('Taker Token B Account is not owned by the Token Program.');
        console.log('Taker Token B Account has incorrect owner', {
          takerTokenAccountB: takerTokenAccountB.toBase58(),
          owner: takerTokenAccountBInfo.owner.toBase58(),
          expected: TOKEN_PROGRAM_ID.toBase58(),
        });
        return;
      }
      if (!makerTokenAccountBInfo.owner.equals(TOKEN_PROGRAM_ID)) {
        setStatus('Maker Token B Account is not owned by the Token Program.');
        console.log('Maker Token B Account has incorrect owner', {
          makerTokenAccountB: makerTokenAccountB.toBase58(),
          owner: makerTokenAccountBInfo.owner.toBase58(),
          expected: TOKEN_PROGRAM_ID.toBase58(),
        });
        return;
      }

      // Verify token account mints
      const { getAccount } = await import('@solana/spl-token');
      const vaultData = await getAccount(connection, vault);
      if (!vaultData.mint.equals(new PublicKey(tokenMintA))) {
        setStatus('Vault ATA is not associated with Token A Mint.');
        console.log('Vault ATA mint mismatch', {
          vaultMint: vaultData.mint.toBase58(),
          expectedMint: tokenMintA,
        });
        return;
      }
      const takerTokenAccountAData = await getAccount(connection, takerTokenAccountA);
      if (!takerTokenAccountAData.mint.equals(new PublicKey(tokenMintA))) {
        setStatus('Taker Token A Account is not associated with Token A Mint.');
        console.log('Taker Token A Account mint mismatch', {
          tokenAccountMint: takerTokenAccountAData.mint.toBase58(),
          expectedMint: tokenMintA,
        });
        return;
      }
      const takerTokenAccountBData = await getAccount(connection, takerTokenAccountB);
      if (!takerTokenAccountBData.mint.equals(new PublicKey(tokenMintB))) {
        setStatus('Taker Token B Account is not associated with Token B Mint.');
        console.log('Taker Token B Account mint mismatch', {
          tokenAccountMint: takerTokenAccountBData.mint.toBase58(),
          expectedMint: tokenMintB,
        });
        return;
      }
      const makerTokenAccountBData = await getAccount(connection, makerTokenAccountB);
      if (!makerTokenAccountBData.mint.equals(new PublicKey(tokenMintB))) {
        setStatus('Maker Token B Account is not associated with Token B Mint.');
        console.log('Maker Token B Account mint mismatch', {
          tokenAccountMint: makerTokenAccountBData.mint.toBase58(),
          expectedMint: tokenMintB,
        });
        return;
      }

      // Verify taker has sufficient Token B balance
      const tokenBAmountLamports = 10 * 10 ** 9; // Assuming 10 tokens from makeOffer
      if (takerTokenAccountBData.amount < BigInt(tokenBAmountLamports)) {
        setStatus(`Insufficient balance in Taker Token B Account. Need 10 tokens.`);
        console.log('Insufficient balance in Token B', {
          available: Number(takerTokenAccountBData.amount) / 10 ** 9,
          required: 10,
        });
        return;
      }

      // Build and send transaction
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

      console.log('Offer transaction sent', { signature: tx });
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      await connection.confirmTransaction({ signature: tx, blockhash, lastValidBlockHeight }, 'confirmed');
      console.log('Offer transaction confirmed');

      setStatus(`Offer taken successfully: ${tx}`);
    } catch (error) {
      setStatus(`Error: ${error.message || 'An unexpected error occurred.'}`);
      console.error('Error in handleTakeOffer:', error);
      if (error.stack) console.error('Stack trace:', error.stack);
      if (error instanceof anchor.AnchorError) {
        console.error('Anchor Error Details:', {
          errorCode: error.errorCode,
          errorMessage: error.errorMessage,
          program: error.program.toBase58(),
          logs: error.logs,
        });
      }
    }
  };

  return (
    <div className="take-offer">
      <h2>Take Offer</h2>
      <input
        type="number"
        placeholder="Offer ID"
        value={offerId}
        onChange={(e) => setOfferId(e.target.value)}
        min="0"
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
      <button onClick={createTakerTokenAAccount} disabled={!publicKey || !wallet || !signTransaction}>
        Create Token A Account
      </button>
      <button onClick={handleTakeOffer} disabled={!publicKey || !wallet || !signTransaction}>
        Take Offer
      </button>
      <p>{status}</p>
    </div>
  );
};