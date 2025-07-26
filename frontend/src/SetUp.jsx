import React, { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

export const Setup = () => {
  const { publicKey, wallet } = useWallet();
  const { connection } = useConnection();
  const [tokenADecimals, setTokenADecimals] = useState('9');
  const [tokenBDecimals, setTokenBDecimals] = useState('9');
  const [tokenAAmount, setTokenAAmount] = useState('');
  const [tokenBAmount, setTokenBAmount] = useState('');
  const [status, setStatus] = useState('');
  const [tokenAMint, setTokenAMint] = useState('');
  const [tokenBMint, setTokenBMint] = useState('');
  const [tokenAAccount, setTokenAAccount] = useState('');
  const [tokenBAccount, setTokenBAccount] = useState('');

  const handleSetup = async () => {
    console.log('handleSetup started', { publicKey: publicKey?.toBase58(), wallet: !!wallet, adapter: !!wallet?.adapter });

    if (!publicKey || !wallet || !wallet.adapter) {
      setStatus('Please connect your wallet.');
      console.log('Wallet not connected, exiting');
      return;
    }

    try {
      setStatus('Creating token mints and accounts...');
      console.log('Starting token creation process...');

      // Validate inputs
      const decimalsA = parseInt(tokenADecimals);
      const decimalsB = parseInt(tokenBDecimals);
      const amountA = parseFloat(tokenAAmount);
      const amountB = parseFloat(tokenBAmount);
      console.log('Input values', { decimalsA, decimalsB, amountA, amountB });

      if (isNaN(decimalsA) || isNaN(decimalsB) || decimalsA < 0 || decimalsB < 0 || decimalsA > 9 || decimalsB > 9) {
        setStatus('Invalid decimals provided. Decimals must be between 0 and 9.');
        console.log('Invalid decimals', { decimalsA, decimalsB });
        return;
      }
      if (isNaN(amountA) || isNaN(amountB) || amountA <= 0 || amountB <= 0) {
        setStatus('Invalid token amounts provided. Amounts must be positive numbers.');
        console.log('Invalid amounts', { amountA, amountB });
        return;
      }

      // Check SOL balance
      console.log('Checking wallet SOL balance...');
      const balance = await connection.getBalance(publicKey);
      console.log('Wallet SOL balance', { balance: balance / LAMPORTS_PER_SOL });
      const minSolRequired = 0.005 * LAMPORTS_PER_SOL * 5; // ~0.025 SOL for safety
      if (balance < minSolRequired) {
        setStatus(`Insufficient SOL balance. Need at least ${minSolRequired / LAMPORTS_PER_SOL} SOL.`);
        console.log('Insufficient SOL balance', { balance: balance / LAMPORTS_PER_SOL });
        return;
      }

      // --- Create Token A Mint ---
      console.log('Creating Token A mint...');
      const tokenAMintKeypair = Keypair.generate();
      console.log('Token A mint keypair generated', { tokenAMintKeypair: tokenAMintKeypair.publicKey.toBase58() });

      const createMintATransaction = new Transaction();
      const rentExemptLamports = await getMinimumBalanceForRentExemptMint(connection);

      createMintATransaction.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: tokenAMintKeypair.publicKey,
          space: MINT_SIZE,
          lamports: rentExemptLamports,
          programId: TOKEN_PROGRAM_ID,
        })
      );

      createMintATransaction.add(
        createInitializeMintInstruction(
          tokenAMintKeypair.publicKey,
          decimalsA,
          publicKey,
          null,
          TOKEN_PROGRAM_ID
        )
      );

      createMintATransaction.feePayer = publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      createMintATransaction.recentBlockhash = blockhash;
      createMintATransaction.lastValidBlockHeight = lastValidBlockHeight;

      console.log('Sending Token A mint creation transaction...', { blockhash });
      try {
        const signatureA = await wallet.adapter.sendTransaction(createMintATransaction, connection, {
          signers: [tokenAMintKeypair],
        });
        console.log('Token A mint transaction sent', { signatureA });
        await connection.confirmTransaction({ signature: signatureA, blockhash, lastValidBlockHeight }, 'confirmed');
        console.log('Token A mint created', { tokenAMint: tokenAMintKeypair.publicKey.toBase58() });
      } catch (txError) {
        console.error('Token A mint transaction failed:', txError);
        throw new Error(`Failed to create Token A mint: ${txError.message || 'Transaction reverted'}`);
      }

      // --- Create Token B Mint ---
      console.log('Creating Token B mint...');
      const tokenBMintKeypair = Keypair.generate();
      console.log('Token B mint keypair generated', { tokenBMintKeypair: tokenBMintKeypair.publicKey.toBase58() });

      const createMintBTransaction = new Transaction();
      createMintBTransaction.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: tokenBMintKeypair.publicKey,
          space: MINT_SIZE,
          lamports: rentExemptLamports,
          programId: TOKEN_PROGRAM_ID,
        })
      );
      createMintBTransaction.add(
        createInitializeMintInstruction(
          tokenBMintKeypair.publicKey,
          decimalsB,
          publicKey,
          null,
          TOKEN_PROGRAM_ID
        )
      );

      createMintBTransaction.feePayer = publicKey;
      const { blockhash: blockhashB, lastValidBlockHeight: lastValidBlockHeightB } = await connection.getLatestBlockhash('confirmed');
      createMintBTransaction.recentBlockhash = blockhashB;
      createMintBTransaction.lastValidBlockHeight = lastValidBlockHeightB;

      console.log('Sending Token B mint creation transaction...', { blockhash: blockhashB });
      try {
        const signatureB = await wallet.adapter.sendTransaction(createMintBTransaction, connection, {
          signers: [tokenBMintKeypair],
        });
        console.log('Token B mint transaction sent', { signatureB });
        await connection.confirmTransaction({ signature: signatureB, blockhash: blockhashB, lastValidBlockHeight: lastValidBlockHeightB }, 'confirmed');
        console.log('Token B mint created', { tokenBMint: tokenBMintKeypair.publicKey.toBase58() });
      } catch (txError) {
        console.error('Token B mint transaction failed:', txError);
        throw new Error(`Failed to create Token B mint: ${txError.message || 'Transaction reverted'}`);
      }

      // --- Create Associated Token Accounts (ATAs) ---
      console.log('Creating Token A associated token account...');
      const tokenAATA = await getAssociatedTokenAddress(
        tokenAMintKeypair.publicKey,
        publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      console.log('Derived Token A ATA address:', tokenAATA.toBase58());

      let tokenAAccountAddress = tokenAATA.toBase58();
      const tokenAAccountInfo = await connection.getAccountInfo(tokenAATA);

      if (!tokenAAccountInfo) {
        console.log('Token A ATA does not exist, creating it...');
        const createATATransactionA = new Transaction();
        createATATransactionA.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            tokenAATA,
            publicKey,
            tokenAMintKeypair.publicKey,
            TOKEN_PROGRAM_ID
          )
        );
        createATATransactionA.feePayer = publicKey;
        const { blockhash: ataBlockhashA, lastValidBlockHeight: ataLastValidBlockHeightA } = await connection.getLatestBlockhash('confirmed');
        createATATransactionA.recentBlockhash = ataBlockhashA;
        createATATransactionA.lastValidBlockHeight = ataLastValidBlockHeightA;

        try {
          const ataASignature = await wallet.adapter.sendTransaction(createATATransactionA, connection);
          console.log('Token A ATA transaction sent', { ataASignature });
          await connection.confirmTransaction({ signature: ataASignature, blockhash: ataBlockhashA, lastValidBlockHeight: ataLastValidBlockHeightA }, 'confirmed');
          console.log('Token A ATA created successfully:', tokenAATA.toBase58());
        } catch (txError) {
          console.error('Token A ATA creation failed:', txError);
          throw new Error(`Failed to create Token A ATA: ${txError.message || 'Transaction reverted'}`);
        }
      } else {
        console.log('Token A ATA already exists:', tokenAATA.toBase58());
      }

      console.log('Creating Token B associated token account...');
      const tokenBATA = await getAssociatedTokenAddress(
        tokenBMintKeypair.publicKey,
        publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      console.log('Derived Token B ATA address:', tokenBATA.toBase58());

      let tokenBAccountAddress = tokenBATA.toBase58();
      const tokenBAccountInfo = await connection.getAccountInfo(tokenBATA);

      if (!tokenBAccountInfo) {
        console.log('Token B ATA does not exist, creating it...');
        const createATATransactionB = new Transaction();
        createATATransactionB.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            tokenBATA,
            publicKey,
            tokenBMintKeypair.publicKey,
            TOKEN_PROGRAM_ID
          )
        );
        createATATransactionB.feePayer = publicKey;
        const { blockhash: ataBlockhashB, lastValidBlockHeight: ataLastValidBlockHeightB } = await connection.getLatestBlockhash('confirmed');
        createATATransactionB.recentBlockhash = ataBlockhashB;
        createATATransactionB.lastValidBlockHeight = ataLastValidBlockHeightB;

        try {
          const ataBSignature = await wallet.adapter.sendTransaction(createATATransactionB, connection);
          console.log('Token B ATA transaction sent', { ataBSignature });
          await connection.confirmTransaction({ signature: ataBSignature, blockhash: ataBlockhashB, lastValidBlockHeight: ataLastValidBlockHeightB }, 'confirmed');
          console.log('Token B ATA created successfully:', tokenBATA.toBase58());
        } catch (txError) {
          console.error('Token B ATA creation failed:', txError);
          throw new Error(`Failed to create Token B ATA: ${txError.message || 'Transaction reverted'}`);
        }
      } else {
        console.log('Token B ATA already exists:', tokenBATA.toBase58());
      }

      // --- Mint tokens to ATAs ---
      const tokenAAmountBN = Math.floor(amountA * 10 ** decimalsA);
      const tokenBAmountBN = Math.floor(amountB * 10 ** decimalsB);
      console.log('Minting tokens', { tokenAAmountBN, tokenBAmountBN });

      console.log('Minting Token A...');
      const mintATransaction = new Transaction();
      mintATransaction.add(
        createMintToInstruction(
          tokenAMintKeypair.publicKey,
          tokenAATA,
          publicKey,
          tokenAAmountBN,
          [],
          TOKEN_PROGRAM_ID
        )
      );
      mintATransaction.feePayer = publicKey;
      const { blockhash: mintBlockhashA, lastValidBlockHeight: mintLastValidBlockHeightA } = await connection.getLatestBlockhash('confirmed');
      mintATransaction.recentBlockhash = mintBlockhashA;
      mintATransaction.lastValidBlockHeight = mintLastValidBlockHeightA;

      try {
        const mintASignature = await wallet.adapter.sendTransaction(mintATransaction, connection);
        console.log('Token A mint-to transaction sent', { mintASignature });
        await connection.confirmTransaction({ signature: mintASignature, blockhash: mintBlockhashA, lastValidBlockHeight: mintLastValidBlockHeightA }, 'confirmed');
        console.log('Token A minted successfully');
      } catch (txError) {
        console.error('Token A mint-to transaction failed:', txError);
        throw new Error(`Failed to mint Token A: ${txError.message || 'Transaction reverted'}`);
      }

      console.log('Minting Token B...');
      const mintBTransaction = new Transaction();
      mintBTransaction.add(
        createMintToInstruction(
          tokenBMintKeypair.publicKey,
          tokenBATA,
          publicKey,
          tokenBAmountBN,
          [],
          TOKEN_PROGRAM_ID
        )
      );
      mintBTransaction.feePayer = publicKey;
      const { blockhash: mintBlockhashB, lastValidBlockHeight: mintLastValidBlockHeightB } = await connection.getLatestBlockhash('confirmed');
      mintBTransaction.recentBlockhash = mintBlockhashB;
      mintBTransaction.lastValidBlockHeight = mintLastValidBlockHeightB;

      try {
        const mintBSignature = await wallet.adapter.sendTransaction(mintBTransaction, connection);
        console.log('Token B mint-to transaction sent', { mintBSignature });
        await connection.confirmTransaction({ signature: mintBSignature, blockhash: mintBlockhashB, lastValidBlockHeight: mintLastValidBlockHeightB }, 'confirmed');
        console.log('Token B minted successfully');
      } catch (txError) {
        console.error('Token B mint-to transaction failed:', txError);
        throw new Error(`Failed to mint Token B: ${txError.message || 'Transaction reverted'}`);
      }

      // Update state with addresses
      setTokenAMint(tokenAMintKeypair.publicKey.toBase58());
      setTokenBMint(tokenBMintKeypair.publicKey.toBase58());
      setTokenAAccount(tokenAATA.toBase58());
      setTokenBAccount(tokenBATA.toBase58());

      setStatus(
        `Success! Token A Mint: ${tokenAMintKeypair.publicKey.toBase58()}, Token A ATA: ${tokenAATA.toBase58()}, ` +
        `Token B Mint: ${tokenBMintKeypair.publicKey.toBase58()}, Token B ATA: ${tokenBATA.toBase58()}`
      );
      console.log('Setup completed successfully');
    } catch (error) {
      setStatus(`Error: ${error.message || 'An unexpected error occurred.'}`);
      console.error('Error in handleSetup:', error);
    }
  };

  return (
    <div className="setup">
      <h2>Setup Tokens</h2>
      <input
        type="number"
        placeholder="Token A Decimals"
        value={tokenADecimals}
        onChange={(e) => setTokenADecimals(e.target.value)}
        min="0"
        max="9"
      />
      <input
        type="number"
        placeholder="Token B Decimals"
        value={tokenBDecimals}
        onChange={(e) => setTokenBDecimals(e.target.value)}
        min="0"
        max="9"
      />
      <input
        type="number"
        placeholder="Token A Amount to Mint"
        value={tokenAAmount}
        onChange={(e) => setTokenAAmount(e.target.value)}
        min="0"
        step="0.01"
      />
      <input
        type="number"
        placeholder="Token B Amount to Mint"
        value={tokenBAmount}
        onChange={(e) => setTokenBAmount(e.target.value)}
        min="0"
        step="0.01"
      />
      <button onClick={handleSetup} disabled={!publicKey || !wallet || !wallet.adapter}>
        Create Tokens and Accounts
      </button>
      {tokenAMint && (
        <p>
          Token A Mint: <code>{tokenAMint}</code>
          <br />
          Token A ATA: <code>{tokenAAccount}</code>
        </p>
      )}
      {tokenBMint && (
        <p>
          Token B Mint: <code>{tokenBMint}</code>
          <br />
          Token B ATA: <code>{tokenBAccount}</code>
        </p>
      )}
      <p>{status}</p>
    </div>
  );
};