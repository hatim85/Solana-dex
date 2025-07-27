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
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createV1,
  findMetadataPda,
  mplTokenMetadata,
  TokenStandard,
  MPL_TOKEN_METADATA_PROGRAM_ID,
} from '@metaplex-foundation/mpl-token-metadata';
import { percentAmount, publicKey as umiPublicKey, signerIdentity } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';

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

  const validatePublicKey = (key, context) => {
    try {
      new PublicKey(key);
      return true;
    } catch (error) {
      console.error(`Invalid public key in ${context}:`, { key, error });
      return false;
    }
  };

  const handleSetup = async () => {
    console.log('handleSetup started', { publicKey: publicKey?.toBase58(), wallet: !!wallet, adapter: !!wallet?.adapter });

    if (!publicKey || !wallet || !wallet.adapter) {
      setStatus('Please connect your wallet.');
      console.log('Wallet not connected, exiting');
      return;
    }

    try {
      setStatus('Creating token mints, accounts, and metadata...');
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
      const minSolRequired = 0.005 * LAMPORTS_PER_SOL * 3; // ~0.015 SOL for 3 transactions
      if (balance < minSolRequired) {
        setStatus(`Insufficient SOL balance. Need at least ${minSolRequired / LAMPORTS_PER_SOL} SOL.`);
        console.log('Insufficient SOL balance', { balance: balance / LAMPORTS_PER_SOL });
        return;
      }

      // Initialize umi
      const umi = createUmi(connection.rpcEndpoint).use(mplTokenMetadata());
      umi.use(signerIdentity({
        publicKey: umiPublicKey(publicKey.toBase58()),
        signTransaction: async (tx) => {
          console.log('signTransaction called with tx:', JSON.stringify(tx, (key, value) => {
            if (value instanceof Uint8Array) return Array.from(value);
            return value;
          }, 2));
          const instructions = tx.message?.instructions || tx.instructions;
          if (!instructions || !Array.isArray(instructions) || instructions.length === 0) {
            console.error('Invalid transaction: instructions are undefined, not an array, or empty', { tx });
            throw new Error('Invalid transaction: no instructions provided');
          }
          const transaction = new Transaction();
          for (const ix of instructions) {
            let keys = ix.keys;
            if (!keys || !Array.isArray(keys)) {
              console.warn('Instruction missing keys, constructing from accountIndexes', { ix });
              if (!ix.accountIndexes || !Array.isArray(ix.accountIndexes)) {
                console.error('Invalid instruction: no keys or accountIndexes provided', { ix });
                throw new Error('Invalid instruction: no keys or accountIndexes provided');
              }
              keys = ix.accountIndexes.map((index, i) => {
                let pubkey = tx.message.accounts[index];
                // Fix for SysvarInstructions
                if (pubkey === 'Sysvar1nstructions1111111111111111111111111') {
                  console.warn('Correcting SysvarInstructions public key');
                  pubkey = SYSVAR_INSTRUCTIONS_PUBKEY.toBase58();
                }
                if (!validatePublicKey(pubkey, 'signTransaction keys construction')) {
                  throw new Error(`Invalid public key at index ${index}: ${pubkey}`);
                }
                return {
                  pubkey,
                  isSigner: i === 3 || i === 4 || i === 5, // Payer, mintAuthority, updateAuthority
                  isWritable: i === 0 || i === 2, // Metadata, mint
                };
              });
            }
            const programPubkey = tx.message.accounts[ix.programIndex];
            if (!validatePublicKey(programPubkey, 'signTransaction program key')) {
              throw new Error(`Invalid program public key at index ${ix.programIndex}: ${programPubkey}`);
            }
            transaction.add({
              keys: keys.map((key) => ({
                pubkey: new PublicKey(key.pubkey),
                isSigner: key.isSigner,
                isWritable: key.isWritable,
              })),
              programId: new PublicKey(programPubkey),
              data: Buffer.from(ix.data),
            });
          }
          transaction.feePayer = publicKey;
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
          transaction.recentBlockhash = blockhash;
          transaction.lastValidBlockHeight = lastValidBlockHeight;
          console.log('Signing transaction with blockhash:', blockhash);
          try {
            const signature = await wallet.adapter.sendTransaction(transaction, connection);
            console.log('Transaction signed and sent', { signature });
            return base58.serialize(signature);
          } catch (signError) {
            console.error('Error signing transaction:', signError);
            throw new Error(`Failed to sign transaction: ${signError.message || 'Unknown error'}`);
          }
        },
      }));

      // Verify umi configuration
      if (!umi.programs.get('mplTokenMetadata')) {
        throw new Error('mplTokenMetadata plugin not registered with umi');
      }

      // Create keypairs for mints
      console.log('Creating Token A mint...');
      const tokenAMintKeypair = Keypair.generate();
      console.log('Token A mint keypair generated', { tokenAMintKeypair: tokenAMintKeypair.publicKey.toBase58() });
      console.log('Creating Token B mint...');
      const tokenBMintKeypair = Keypair.generate();
      console.log('Token B mint keypair generated', { tokenBMintKeypair: tokenBMintKeypair.publicKey.toBase58() });

      // Validate mint public keys
      if (!tokenAMintKeypair.publicKey || !tokenBMintKeypair.publicKey) {
        throw new Error('Failed to generate valid mint keypairs');
      }

      // Get rent exemption
      const rentExemptLamports = await getMinimumBalanceForRentExemptMint(connection);

      // Transaction 1: Mints and ATAs
      const transaction1 = new Transaction();
      let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

      // Token A Mint
      transaction1.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: tokenAMintKeypair.publicKey,
          space: MINT_SIZE,
          lamports: rentExemptLamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          tokenAMintKeypair.publicKey,
          decimalsA,
          publicKey,
          null,
          TOKEN_PROGRAM_ID
        )
      );

      // Token B Mint
      transaction1.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: tokenBMintKeypair.publicKey,
          space: MINT_SIZE,
          lamports: rentExemptLamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          tokenBMintKeypair.publicKey,
          decimalsB,
          publicKey,
          null,
          TOKEN_PROGRAM_ID
        )
      );

      // Token A ATA
      const tokenAATA = await getAssociatedTokenAddress(
        tokenAMintKeypair.publicKey,
        publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      console.log('Derived Token A ATA address:', tokenAATA.toBase58());
      const tokenAAccountInfo = await connection.getAccountInfo(tokenAATA);
      if (!tokenAAccountInfo) {
        console.log('Token A ATA does not exist, creating it...');
        transaction1.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            tokenAATA,
            publicKey,
            tokenAMintKeypair.publicKey,
            TOKEN_PROGRAM_ID
          )
        );
      } else {
        console.log('Token A ATA already exists:', tokenAATA.toBase58());
      }

      // Token B ATA
      const tokenBATA = await getAssociatedTokenAddress(
        tokenBMintKeypair.publicKey,
        publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      console.log('Derived Token B ATA address:', tokenBATA.toBase58());
      const tokenBAccountInfo = await connection.getAccountInfo(tokenBATA);
      if (!tokenBAccountInfo) {
        console.log('Token B ATA does not exist, creating it...');
        transaction1.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            tokenBATA,
            publicKey,
            tokenBMintKeypair.publicKey,
            TOKEN_PROGRAM_ID
          )
        );
      } else {
        console.log('Token B ATA already exists:', tokenBATA.toBase58());
      }

      // Send Transaction 1
      transaction1.feePayer = publicKey;
      transaction1.recentBlockhash = blockhash;
      transaction1.lastValidBlockHeight = lastValidBlockHeight;
      console.log('Sending transaction 1 (mints, ATAs)...', { blockhash });
      try {
        const signature1 = await wallet.adapter.sendTransaction(transaction1, connection, {
          signers: [tokenAMintKeypair, tokenBMintKeypair],
        });
        console.log('Transaction 1 sent', { signature1 });
        await connection.confirmTransaction({ signature: signature1, blockhash, lastValidBlockHeight }, 'confirmed');
        console.log('Transaction 1 confirmed');
      } catch (txError) {
        console.error('Transaction 1 failed:', txError);
        throw new Error(`Failed to create mints and ATAs: ${txError.message || 'Transaction failed'}`);
      }

      // Transaction 2: Token A Metadata
      ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed'));
      let tokenAMetadataPDA;
      try {
        const tokenAMintUmi = umiPublicKey(tokenAMintKeypair.publicKey.toBase58());
        console.log('Token A mint for PDA:', tokenAMintUmi.toString());
        const tokenAMetadataPdaArray = findMetadataPda(umi, { mint: tokenAMintUmi });
        console.log('Token A metadata PDA raw output:', tokenAMetadataPdaArray);
        if (!Array.isArray(tokenAMetadataPdaArray) || tokenAMetadataPdaArray.length === 0) {
          const [pda] = await PublicKey.findProgramAddress(
            [
              Buffer.from('metadata'),
              new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
              tokenAMintKeypair.publicKey.toBuffer(),
            ],
            new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
          );
          tokenAMetadataPDA = umiPublicKey(pda.toBase58());
          console.log('Token A metadata PDA (fallback):', tokenAMetadataPDA.toString());
        } else {
          tokenAMetadataPDA = tokenAMetadataPdaArray[0];
          console.log('Token A metadata PDA:', tokenAMetadataPDA.toString());
        }
      } catch (pdaError) {
        console.error('Error deriving Token A metadata PDA:', pdaError);
        throw new Error(`Failed to derive Token A metadata PDA: ${pdaError.message}`);
      }
      let tokenAMetadataBuilder = createV1(umi, {
        mint: umiPublicKey(tokenAMintKeypair.publicKey.toBase58()),
        authority: umi.identity,
        payer: umi.identity,
        updateAuthority: umi.identity,
        name: 'Token A',
        symbol: 'TKNA',
        uri: 'https://example.com/token-a.json',
        sellerFeeBasisPoints: percentAmount(0),
        tokenStandard: TokenStandard.Fungible,
      });
      console.log('Token A metadata builder:', JSON.stringify(tokenAMetadataBuilder, null, 2));
      let tokenAMetadataTx;
      let buildAttempts = 0;
      const maxBuildAttempts = 3;
      while (buildAttempts < maxBuildAttempts) {
        try {
          buildAttempts++;
          tokenAMetadataTx = await tokenAMetadataBuilder.setBlockhash(blockhash).build(umi);
          console.log('Token A metadata transaction built (attempt ' + buildAttempts + '):', JSON.stringify(tokenAMetadataTx, (key, value) => {
            if (value instanceof Uint8Array) return Array.from(value);
            return value;
          }, 2));
          // Validate instructions
          const instructions = tokenAMetadataTx.message?.instructions || tokenAMetadataTx.instructions;
          console.log('Validating Token A metadata transaction instructions:', {
            hasInstructions: !!instructions,
            isArray: Array.isArray(instructions),
            instructionCount: instructions ? instructions.length : 0,
            instructionsExist: !!tokenAMetadataTx.instructions,
            messageInstructionsExist: !!tokenAMetadataTx.message?.instructions,
          });
          if (!instructions || !Array.isArray(instructions) || instructions.length === 0) {
            console.error('Invalid Token A metadata transaction: no instructions', { tokenAMetadataTx });
            // Rebuild builder to reset state
            tokenAMetadataBuilder = createV1(umi, {
              mint: umiPublicKey(tokenAMintKeypair.publicKey.toBase58()),
              authority: umi.identity,
              payer: umi.identity,
              updateAuthority: umi.identity,
              name: 'Token A',
              symbol: 'TKNA',
              uri: 'https://example.com/token-a.json',
              sellerFeeBasisPoints: percentAmount(0),
              tokenStandard: TokenStandard.Fungible,
            });
            throw new Error('No instructions found in transaction');
          }
          // Validate instruction keys
          for (const ix of instructions) {
            console.log('Inspecting instruction:', { ix });
            let keys = ix.keys;
            if (!keys || !Array.isArray(keys)) {
              console.warn('Instruction missing keys, constructing from accountIndexes', { ix });
              if (!ix.accountIndexes || !Array.isArray(ix.accountIndexes)) {
                console.error('Invalid instruction: no keys or accountIndexes provided', { ix });
                throw new Error('Invalid instruction: no keys or accountIndexes provided');
              }
              // Construct keys from accountIndexes
              keys = ix.accountIndexes.map((index, i) => {
                let pubkey = tokenAMetadataTx.message.accounts[index];
                // Fix for SysvarInstructions
                if (pubkey === 'Sysvar1nstructions1111111111111111111111111') {
                  console.warn('Correcting SysvarInstructions public key');
                  pubkey = SYSVAR_INSTRUCTIONS_PUBKEY.toBase58();
                }
                if (!validatePublicKey(pubkey, 'Token A metadata keys construction')) {
                  throw new Error(`Invalid public key at index ${index}: ${pubkey}`);
                }
                return {
                  pubkey,
                  isSigner: i === 3 || i === 4 || i === 5, // Payer, mintAuthority, updateAuthority
                  isWritable: i === 0 || i === 2, // Metadata, mint
                };
              });
              ix.keys = keys; // Assign constructed keys
            }
          }
          break; // Success, exit loop
        } catch (buildError) {
          console.error('Failed to build Token A metadata transaction (attempt ' + buildAttempts + '):', buildError);
          if (buildAttempts === maxBuildAttempts) {
            throw new Error(`Failed to build Token A metadata transaction after ${maxBuildAttempts} attempts: ${buildError.message}`);
          }
          // Refresh blockhash for next attempt
          ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed'));
        }
      }
      const transaction2 = new Transaction();
      const instructionsA = tokenAMetadataTx.message?.instructions || tokenAMetadataTx.instructions;
      for (const ix of instructionsA) {
        if (!ix.keys || !Array.isArray(ix.keys)) {
          console.error('Invalid instruction after validation: keys are undefined or not an array', { ix });
          throw new Error('Invalid instruction: no keys provided');
        }
        const programPubkey = tokenAMetadataTx.message.accounts[ix.programIndex];
        if (!validatePublicKey(programPubkey, 'Transaction 2 program key')) {
          throw new Error(`Invalid program public key at index ${ix.programIndex}: ${programPubkey}`);
        }
        transaction2.add({
          keys: ix.keys.map((key) => {
            if (!validatePublicKey(key.pubkey, 'Transaction 2 keys mapping')) {
              throw new Error(`Invalid public key in transaction: ${key.pubkey}`);
            }
            return {
              pubkey: new PublicKey(key.pubkey),
              isSigner: key.isSigner,
              isWritable: key.isWritable,
            };
          }),
          programId: new PublicKey(programPubkey),
          data: Buffer.from(ix.data),
        });
      }
      transaction2.feePayer = publicKey;
      transaction2.recentBlockhash = blockhash;
      transaction2.lastValidBlockHeight = lastValidBlockHeight;
      try {
        const signature2 = await wallet.adapter.sendTransaction(transaction2, connection);
        console.log('Token A metadata transaction sent', { signature2 });
        await connection.confirmTransaction({ signature: signature2, blockhash, lastValidBlockHeight }, 'confirmed');
        console.log('Token A metadata transaction confirmed');
      } catch (txError) {
        console.error('Token A metadata transaction failed:', txError);
        throw new Error(`Failed to create Token A metadata: ${txError.message || 'Transaction failed'}`);
      }

      // Transaction 3: Token B Metadata
      ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed'));
      let tokenBMetadataPDA;
      try {
        const tokenBMintUmi = umiPublicKey(tokenBMintKeypair.publicKey.toBase58());
        console.log('Token B mint for PDA:', tokenBMintUmi.toString());
        const tokenBMetadataPdaArray = findMetadataPda(umi, { mint: tokenBMintUmi });
        console.log('Token B metadata PDA raw output:', tokenBMetadataPdaArray);
        if (!Array.isArray(tokenBMetadataPdaArray) || tokenBMetadataPdaArray.length === 0) {
          const [pda] = await PublicKey.findProgramAddress(
            [
              Buffer.from('metadata'),
              new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID).toBuffer(),
              tokenBMintKeypair.publicKey.toBuffer(),
            ],
            new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)
          );
          tokenBMetadataPDA = umiPublicKey(pda.toBase58());
          console.log('Token B metadata PDA (fallback):', tokenBMetadataPDA.toString());
        } else {
          tokenBMetadataPDA = tokenBMetadataPdaArray[0];
          console.log('Token B metadata PDA:', tokenBMetadataPDA.toString());
        }
      } catch (pdaError) {
        console.error('Error deriving Token B metadata PDA:', pdaError);
        throw new Error(`Failed to derive Token B metadata PDA: ${pdaError.message}`);
      }
      let tokenBMetadataBuilder = createV1(umi, {
        mint: umiPublicKey(tokenBMintKeypair.publicKey.toBase58()),
        authority: umi.identity,
        payer: umi.identity,
        updateAuthority: umi.identity,
        name: 'Token B',
        symbol: 'TKNB',
        uri: 'https://example.com/token-b.json',
        sellerFeeBasisPoints: percentAmount(0),
        tokenStandard: TokenStandard.Fungible,
      });
      console.log('Token B metadata builder:', JSON.stringify(tokenBMetadataBuilder, null, 2));
      let tokenBMetadataTx;
      let buildAttemptsB = 0;
      const maxBuildAttemptsB = 3;
      while (buildAttemptsB < maxBuildAttemptsB) {
        try {
          buildAttemptsB++;
          tokenBMetadataTx = await tokenBMetadataBuilder.setBlockhash(blockhash).build(umi);
          console.log('Token B metadata transaction built (attempt ' + buildAttemptsB + '):', JSON.stringify(tokenBMetadataTx, (key, value) => {
            if (value instanceof Uint8Array) return Array.from(value);
            return value;
          }, 2));
          // Validate instructions
          const instructionsB = tokenBMetadataTx.message?.instructions || tokenBMetadataTx.instructions;
          console.log('Validating Token B metadata transaction instructions:', {
            hasInstructions: !!instructionsB,
            isArray: Array.isArray(instructionsB),
            instructionCount: instructionsB ? instructionsB.length : 0,
            instructionsExist: !!tokenBMetadataTx.instructions,
            messageInstructionsExist: !!tokenBMetadataTx.message?.instructions,
          });
          if (!instructionsB || !Array.isArray(instructionsB) || instructionsB.length === 0) {
            console.error('Invalid Token B metadata transaction: no instructions', { tokenBMetadataTx });
            // Rebuild builder to reset state
            tokenBMetadataBuilder = createV1(umi, {
              mint: umiPublicKey(tokenBMintKeypair.publicKey.toBase58()),
              authority: umi.identity,
              payer: umi.identity,
              updateAuthority: umi.identity,
              name: 'Token B',
              symbol: 'TKNB',
              uri: 'https://example.com/token-b.json',
              sellerFeeBasisPoints: percentAmount(0),
              tokenStandard: TokenStandard.Fungible,
            });
            throw new Error('No instructions found in transaction');
          }
          // Validate instruction keys
          for (const ix of instructionsB) {
            console.log('Inspecting instruction:', { ix });
            let keys = ix.keys;
            if (!keys || !Array.isArray(keys)) {
              console.warn('Instruction missing keys, constructing from accountIndexes', { ix });
              if (!ix.accountIndexes || !Array.isArray(ix.accountIndexes)) {
                console.error('Invalid instruction: no keys or accountIndexes provided', { ix });
                throw new Error('Invalid instruction: no keys or accountIndexes provided');
              }
              // Construct keys from accountIndexes
              keys = ix.accountIndexes.map((index, i) => {
                let pubkey = tokenBMetadataTx.message.accounts[index];
                // Fix for SysvarInstructions
                if (pubkey === 'Sysvar1nstructions1111111111111111111111111') {
                  console.warn('Correcting SysvarInstructions public key');
                  pubkey = SYSVAR_INSTRUCTIONS_PUBKEY.toBase58();
                }
                if (!validatePublicKey(pubkey, 'Token B metadata keys construction')) {
                  throw new Error(`Invalid public key at index ${index}: ${pubkey}`);
                }
                return {
                  pubkey,
                  isSigner: i === 3 || i === 4 || i === 5, // Payer, mintAuthority, updateAuthority
                  isWritable: i === 0 || i === 2, // Metadata, mint
                };
              });
              ix.keys = keys; // Assign constructed keys
            }
          }
          break; // Success, exit loop
        } catch (buildError) {
          console.error('Failed to build Token B metadata transaction (attempt ' + buildAttemptsB + '):', buildError);
          if (buildAttemptsB === maxBuildAttemptsB) {
            throw new Error(`Failed to build Token B metadata transaction after ${maxBuildAttemptsB} attempts: ${buildError.message}`);
          }
          // Refresh blockhash for next attempt
          ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed'));
        }
      }
      const transaction3 = new Transaction();
      const instructionsB = tokenBMetadataTx.message?.instructions || tokenBMetadataTx.instructions;
      for (const ix of instructionsB) {
        if (!ix.keys || !Array.isArray(ix.keys)) {
          console.error('Invalid instruction after validation: keys are undefined or not an array', { ix });
          throw new Error('Invalid instruction: no keys provided');
        }
        const programPubkey = tokenBMetadataTx.message.accounts[ix.programIndex];
        if (!validatePublicKey(programPubkey, 'Transaction 3 program key')) {
          throw new Error(`Invalid program public key at index ${ix.programIndex}: ${programPubkey}`);
        }
        transaction3.add({
          keys: ix.keys.map((key) => {
            if (!validatePublicKey(key.pubkey, 'Transaction 3 keys mapping')) {
              throw new Error(`Invalid public key in transaction: ${key.pubkey}`);
            }
            return {
              pubkey: new PublicKey(key.pubkey),
              isSigner: key.isSigner,
              isWritable: key.isWritable,
            };
          }),
          programId: new PublicKey(programPubkey),
          data: Buffer.from(ix.data),
        });
      }
      transaction3.feePayer = publicKey;
      transaction3.recentBlockhash = blockhash;
      transaction3.lastValidBlockHeight = lastValidBlockHeight;
      try {
        const signature3 = await wallet.adapter.sendTransaction(transaction3, connection);
        console.log('Token B metadata transaction sent', { signature3 });
        await connection.confirmTransaction({ signature: signature3, blockhash, lastValidBlockHeight }, 'confirmed');
        console.log('Token B metadata transaction confirmed');
      } catch (txError) {
        console.error('Token B metadata transaction failed:', txError);
        throw new Error(`Failed to create Token B metadata: ${txError.message || 'Transaction failed'}`);
      }

      // Transaction 4: Mint tokens
      ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed'));
      const transaction4 = new Transaction();
      const tokenAAmountBN = Math.floor(amountA * 10 ** decimalsA);
      const tokenBAmountBN = Math.floor(amountB * 10 ** decimalsB);
      console.log('Minting tokens:', { tokenAAmountBN, tokenBAmountBN });

      transaction4.add(
        createMintToInstruction(
          tokenAMintKeypair.publicKey,
          tokenAATA,
          publicKey,
          tokenAAmountBN,
          [],
          TOKEN_PROGRAM_ID
        ),
        createMintToInstruction(
          tokenBMintKeypair.publicKey,
          tokenBATA,
          publicKey,
          tokenBAmountBN,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      // Send Transaction 4
      transaction4.feePayer = publicKey;
      transaction4.recentBlockhash = blockhash;
      transaction4.lastValidBlockHeight = lastValidBlockHeight;
      console.log('Sending transaction 4 (minting)...', { blockhash });
      try {
        const signature4 = await wallet.adapter.sendTransaction(transaction4, connection);
        console.log('Transaction 4 sent', { signature4 });
        await connection.confirmTransaction({ signature: signature4, blockhash, lastValidBlockHeight }, 'confirmed');
        console.log('Transaction 4 confirmed');
      } catch (txError) {
        console.error('Transaction 4 failed:', txError);
        throw new Error(`Failed to mint tokens: ${txError.message || 'Transaction failed'}`);
      }

      // Update state
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
      if (error.stack) console.error('Stack trace:', error.stack);
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