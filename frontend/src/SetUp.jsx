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
import { PinataSDK } from 'pinata';
import { Upload, Coins, CheckCircle, AlertCircle, Loader } from 'lucide-react';

const pinata = new PinataSDK({
  pinataJwt: import.meta.env.VITE_PINATA_JWT,
  pinataGateway: import.meta.env.VITE_GATEWAY_URL,
});

export const Setup = () => {
  const { publicKey, wallet } = useWallet();
  const { connection } = useConnection();
  const [tokenAAmount, setTokenAAmount] = useState('');
  const [tokenBAmount, setTokenBAmount] = useState('');
  const [tokenAName, setTokenAName] = useState('');
  const [tokenBName, setTokenBName] = useState('');
  const [tokenASymbol, setTokenASymbol] = useState('');
  const [tokenBSymbol, setTokenBSymbol] = useState('');
  const [tokenAFile, setTokenAFile] = useState(null);
  const [tokenBFile, setTokenBFile] = useState(null);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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

  const uploadToPinata = async (file) => {
    if (!file) throw new Error('No file provided for upload');
    const pinataJwt = import.meta.env.VITE_PINATA_JWT;
    const gatewayUrl = import.meta.env.VITE_GATEWAY_URL;
    console.log('Pinata configuration:', { pinataJwt: !!pinataJwt, gatewayUrl });
    if (!pinataJwt || !gatewayUrl) {
      throw new Error('Pinata JWT or Gateway URL not configured in environment variables');
    }
    try {
      const upload = await pinata.upload.public.file(file);
      console.log('Pinata upload response:', { cid: upload.cid });
      if (!upload.cid) {
        throw new Error('Upload failed: No CID returned');
      }
      const ipfsLink = await pinata.gateways.public.convert(upload.cid);
      console.log('Converted IPFS link:', ipfsLink);
      return ipfsLink;
    } catch (error) {
      console.error('Pinata upload failed:', error);
      throw new Error(`Failed to upload to Pinata: ${error.message || 'Unknown error'}`);
    }
  };

  const estimateTransactionSize = (transaction) => {
    try {
      const message = transaction.serializeMessage();
      return message.length;
    } catch (error) {
      console.error('Error estimating transaction size:', error);
      return 0;
    }
  };

  const sendTransactionWithConfirmation = async (transaction, signers, blockhash, lastValidBlockHeight) => {
    transaction.feePayer = publicKey;
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    const signature = await wallet.adapter.sendTransaction(transaction, connection, { signers });
    console.log('Transaction sent', { signature });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log('Transaction confirmed', { signature });
    return signature;
  };

  const handleSetup = async () => {
    if (!publicKey || !wallet || !wallet.adapter) {
      setStatus('Please connect your wallet.');
      return;
    }

    setIsLoading(true);
    
    try {
      setStatus('Uploading images to IPFS and creating tokens...');

      // Hardcode decimals to 9
      const decimalsA = 9;
      const decimalsB = 9;
      const amountA = parseFloat(tokenAAmount);
      const amountB = parseFloat(tokenBAmount);

      // Validate inputs
      if (isNaN(amountA) || isNaN(amountB) || amountA <= 0 || amountB <= 0) {
        setStatus('Invalid token amounts provided. Amounts must be positive numbers.');
        return;
      }
      if (!tokenAName || !tokenBName || !tokenASymbol || !tokenBSymbol) {
        setStatus('All token name and symbol fields must be filled.');
        return;
      }
      if (!tokenAFile || !tokenBFile) {
        setStatus('Please upload images for both tokens.');
        return;
      }
      const validImageTypes = ['image/jpeg', 'image/png', 'image/gif'];
      if (!validImageTypes.includes(tokenAFile.type) || !validImageTypes.includes(tokenBFile.type)) {
        setStatus('Invalid image file type. Only JPEG, PNG, and GIF are supported.');
        return;
      }

      // Upload images to Pinata
      setStatus('Uploading Token A image to IPFS...');
      const tokenAUri = await uploadToPinata(tokenAFile);
      setStatus('Uploading Token B image to IPFS...');
      const tokenBUri = await uploadToPinata(tokenBFile);

      // Check SOL balance
      const balance = await connection.getBalance(publicKey);
      const minSolRequired = 0.015 * LAMPORTS_PER_SOL;
      if (balance < minSolRequired) {
        setStatus(`Insufficient SOL balance. Need at least ${minSolRequired / LAMPORTS_PER_SOL} SOL.`);
        return;
      }

      // Initialize umi
      const umi = createUmi(connection.rpcEndpoint).use(mplTokenMetadata());
      umi.use(signerIdentity({
        publicKey: umiPublicKey(publicKey.toBase58()),
        signTransaction: async (tx) => {
          const instructions = tx.message?.instructions || tx.instructions;
          if (!instructions || !Array.isArray(instructions) || instructions.length === 0) {
            throw new Error('Invalid transaction: no instructions provided');
          }
          const transaction = new Transaction();
          for (const ix of instructions) {
            let keys = ix.keys;
            if (!keys || !Array.isArray(keys)) {
              if (!ix.accountIndexes || !Array.isArray(ix.accountIndexes)) {
                throw new Error('Invalid instruction: no keys or accountIndexes provided');
              }
              keys = ix.accountIndexes.map((index, i) => {
                let pubkey = tx.message.accounts[index];
                if (pubkey === 'Sysvar1nstructions1111111111111111111111111') {
                  pubkey = SYSVAR_INSTRUCTIONS_PUBKEY.toBase58();
                }
                if (!validatePublicKey(pubkey, 'signTransaction keys construction')) {
                  throw new Error(`Invalid public key at index ${index}: ${pubkey}`);
                }
                return {
                  pubkey,
                  isSigner: i === 3 || i === 4 || i === 5 || i === 8 || i === 9 || i === 10,
                  isWritable: i === 0 || i === 2 || i === 6 || i === 7,
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
          try {
            const signature = await wallet.adapter.sendTransaction(transaction, connection);
            return base58.serialize(signature);
          } catch (signError) {
            throw new Error(`Failed to sign transaction: ${signError.message || 'Unknown error'}`);
          }
        },
      }));

      // Create keypairs for mints
      const tokenAMintKeypair = Keypair.generate();
      const tokenBMintKeypair = Keypair.generate();

      // Get rent exemption
      const rentExemptLamports = await getMinimumBalanceForRentExemptMint(connection);

      // Prepare transactions
      let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const transactionA = new Transaction();
      const transactionB = new Transaction();
      let useSingleTransaction = true;

      // Token A Mint
      transactionA.add(
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

      // Token A ATA
      const tokenAATA = await getAssociatedTokenAddress(
        tokenAMintKeypair.publicKey,
        publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      const tokenAAccountInfo = await connection.getAccountInfo(tokenAATA);
      if (!tokenAAccountInfo) {
        transactionA.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            tokenAATA,
            publicKey,
            tokenAMintKeypair.publicKey,
            TOKEN_PROGRAM_ID
          )
        );
      }

      // Token A Metadata
      let tokenAMetadataBuilder = createV1(umi, {
        mint: umiPublicKey(tokenAMintKeypair.publicKey.toBase58()),
        authority: umi.identity,
        payer: umi.identity,
        updateAuthority: umi.identity,
        name: tokenAName,
        symbol: tokenASymbol,
        uri: tokenAUri,
        sellerFeeBasisPoints: percentAmount(0),
        tokenStandard: TokenStandard.Fungible,
      });
      
      let tokenAMetadataTx = await tokenAMetadataBuilder.setBlockhash(blockhash).build(umi);
      const instructionsA = tokenAMetadataTx.message?.instructions || tokenAMetadataTx.instructions;
      for (const ix of instructionsA) {
        if (!ix.keys || !Array.isArray(ix.keys)) {
          if (!ix.accountIndexes || !Array.isArray(ix.accountIndexes)) {
            throw new Error('Invalid instruction: no keys or accountIndexes provided');
          }
          ix.keys = ix.accountIndexes.map((index, i) => {
            let pubkey = tokenAMetadataTx.message.accounts[index];
            if (pubkey === 'Sysvar1nstructions1111111111111111111111111') {
              pubkey = SYSVAR_INSTRUCTIONS_PUBKEY.toBase58();
            }
            if (!validatePublicKey(pubkey, 'Token A metadata keys construction')) {
              throw new Error(`Invalid public key at index ${index}: ${pubkey}`);
            }
            return {
              pubkey,
              isSigner: i === 3 || i === 4 || i === 5,
              isWritable: i === 0 || i === 2,
            };
          });
        }
        const programPubkey = tokenAMetadataTx.message.accounts[ix.programIndex];
        if (!validatePublicKey(programPubkey, 'Token A metadata program key')) {
          throw new Error(`Invalid program public key at index ${ix.programIndex}: ${programPubkey}`);
        }
        transactionA.add({
          keys: ix.keys.map((key) => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          programId: new PublicKey(programPubkey),
          data: Buffer.from(ix.data),
        });
      }

      // Token B Mint
      transactionB.add(
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

      // Token B ATA
      const tokenBATA = await getAssociatedTokenAddress(
        tokenBMintKeypair.publicKey,
        publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      const tokenBAccountInfo = await connection.getAccountInfo(tokenBATA);
      if (!tokenBAccountInfo) {
        transactionB.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            tokenBATA,
            publicKey,
            tokenBMintKeypair.publicKey,
            TOKEN_PROGRAM_ID
          )
        );
      }

      // Token B Metadata
      let tokenBMetadataBuilder = createV1(umi, {
        mint: umiPublicKey(tokenBMintKeypair.publicKey.toBase58()),
        authority: umi.identity,
        payer: umi.identity,
        updateAuthority: umi.identity,
        name: tokenBName,
        symbol: tokenBSymbol,
        uri: tokenBUri,
        sellerFeeBasisPoints: percentAmount(0),
        tokenStandard: TokenStandard.Fungible,
      });
      
      let tokenBMetadataTx = await tokenBMetadataBuilder.setBlockhash(blockhash).build(umi);
      const instructionsB = tokenBMetadataTx.message?.instructions || tokenBMetadataTx.instructions;
      for (const ix of instructionsB) {
        if (!ix.keys || !Array.isArray(ix.keys)) {
          if (!ix.accountIndexes || !Array.isArray(ix.accountIndexes)) {
            throw new Error('Invalid instruction: no keys or accountIndexes provided');
          }
          ix.keys = ix.accountIndexes.map((index, i) => {
            let pubkey = tokenBMetadataTx.message.accounts[index];
            if (pubkey === 'Sysvar1nstructions1111111111111111111111111') {
              pubkey = SYSVAR_INSTRUCTIONS_PUBKEY.toBase58();
            }
            if (!validatePublicKey(pubkey, 'Token B metadata keys construction')) {
              throw new Error(`Invalid public key at index ${index}: ${pubkey}`);
            }
            return {
              pubkey,
              isSigner: i === 3 || i === 4 || i === 5,
              isWritable: i === 0 || i === 2,
            };
          });
        }
        const programPubkey = tokenBMetadataTx.message.accounts[ix.programIndex];
        if (!validatePublicKey(programPubkey, 'Token B metadata program key')) {
          throw new Error(`Invalid program public key at index ${ix.programIndex}: ${programPubkey}`);
        }
        transactionB.add({
          keys: ix.keys.map((key) => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          programId: new PublicKey(programPubkey),
          data: Buffer.from(ix.data),
        });
      }

      // Mint tokens
      const tokenAAmountBN = Math.floor(amountA * 10 ** decimalsA);
      const tokenBAmountBN = Math.floor(amountB * 10 ** decimalsB);

      transactionA.add(
        createMintToInstruction(
          tokenAMintKeypair.publicKey,
          tokenAATA,
          publicKey,
          tokenAAmountBN,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      transactionB.add(
        createMintToInstruction(
          tokenBMintKeypair.publicKey,
          tokenBATA,
          publicKey,
          tokenBAmountBN,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      // Try single transaction
      const combinedTransaction = new Transaction();
      combinedTransaction.instructions = [...transactionA.instructions, ...transactionB.instructions];
      combinedTransaction.feePayer = publicKey;
      combinedTransaction.recentBlockhash = blockhash;
      combinedTransaction.lastValidBlockHeight = lastValidBlockHeight;

      const txSize = estimateTransactionSize(combinedTransaction);

      if (txSize > 1232) {
        useSingleTransaction = false;
      }

      if (useSingleTransaction) {
        setStatus('Sending combined transaction...');
        try {
          await sendTransactionWithConfirmation(combinedTransaction, [tokenAMintKeypair, tokenBMintKeypair], blockhash, lastValidBlockHeight);
          setStatus('Combined transaction confirmed');
        } catch (txError) {
          if (txError.message && txError.message.includes('Transaction too large')) {
            useSingleTransaction = false;
          } else {
            throw new Error(`Failed to execute combined transaction: ${txError.message || 'Transaction failed'}`);
          }
        }
      }

      if (!useSingleTransaction) {
        setStatus('Sending Token A transaction...');
        await sendTransactionWithConfirmation(transactionA, [tokenAMintKeypair], blockhash, lastValidBlockHeight);
        setStatus('Token A transaction confirmed. Sending Token B transaction...');

        // Refresh blockhash for second transaction
        ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed'));
        await sendTransactionWithConfirmation(transactionB, [tokenBMintKeypair], blockhash, lastValidBlockHeight);
        setStatus('Token B transaction confirmed');
      }

      // Update state
      setTokenAMint(tokenAMintKeypair.publicKey.toBase58());
      setTokenBMint(tokenBMintKeypair.publicKey.toBase58());
      setTokenAAccount(tokenAATA.toBase58());
      setTokenBAccount(tokenBATA.toBase58());

      setStatus('Success! Tokens created successfully.');
    } catch (error) {
      setStatus(`Error: ${error.message || 'An unexpected error occurred.'}`);
      console.error('Error in handleSetup:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (file, tokenType) => {
    if (tokenType === 'A') {
      setTokenAFile(file);
    } else {
      setTokenBFile(file);
    }
  };

  const FileUpload = ({ file, onChange, label, id }) => (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <div className="relative">
        <input
          type="file"
          accept="image/jpeg,image/png,image/gif"
          onChange={(e) => onChange(e.target.files[0])}
          className="hidden"
          id={id}
        />
        <label
          htmlFor={id}
          className="flex items-center justify-center w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors duration-200"
        >
          <div className="text-center">
            <Upload size={24} className="mx-auto text-gray-400 mb-2" />
            <span className="text-sm text-gray-600">
              {file ? file.name : 'Click to upload image'}
            </span>
          </div>
        </label>
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <style>
        {`
          .no-spinner::-webkit-inner-spin-button,
          .no-spinner::-webkit-outer-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }
          .no-spinner {
            -moz-appearance: textfield;
          }
        `}
      </style>
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Coins size={28} />
            Setup Tokens
          </h2>
          <p className="text-blue-100 mt-1">Create custom SPL tokens with metadata</p>
        </div>

        <div className="p-6">
          <div className="grid lg:grid-cols-2 gap-8">
            {/* Token A */}
            <div className="space-y-6">
              <div className="border-l-4 border-blue-500 pl-4">
                <h3 className="text-xl font-semibold text-gray-800 mb-4">Token A</h3>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Token Name</label>
                  <input
                    type="text"
                    placeholder="e.g., My Awesome Token"
                    value={tokenAName}
                    onChange={(e) => setTokenAName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Token Symbol</label>
                  <input
                    type="text"
                    placeholder="e.g., MAT"
                    value={tokenASymbol}
                    onChange={(e) => setTokenASymbol(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  />
                </div>

                <FileUpload
                  file={tokenAFile}
                  onChange={(file) => handleFileChange(file, 'A')}
                  label="Token A Image"
                  id="file-token-a"
                />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Amount to Mint</label>
                  <input
                    type="number"
                    placeholder="1000"
                    value={tokenAAmount}
                    onChange={(e) => setTokenAAmount(e.target.value)}
                    min="0"
                    step="0.01"
                    className="no-spinner w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  />
                </div>
              </div>
            </div>

            {/* Token B */}
            <div className="space-y-6">
              <div className="border-l-4 border-purple-500 pl-4">
                <h3 className="text-xl font-semibold text-gray-800 mb-4">Token B</h3>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Token Name</label>
                  <input
                    type="text"
                    placeholder="e.g., Another Great Token"
                    value={tokenBName}
                    onChange={(e) => setTokenBName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Token Symbol</label>
                  <input
                    type="text"
                    placeholder="e.g., AGT"
                    value={tokenBSymbol}
                    onChange={(e) => setTokenBSymbol(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                  />
                </div>

                <FileUpload
                  file={tokenBFile}
                  onChange={(file) => handleFileChange(file, 'B')}
                  label="Token B Image"
                  id="file-token-b"
                />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Amount to Mint</label>
                  <input
                    type="number"
                    placeholder="1000"
                    value={tokenBAmount}
                    onChange={(e) => setTokenBAmount(e.target.value)}
                    min="0"
                    step="0.01"
                    className="no-spinner w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <button
              onClick={handleSetup}
              disabled={!publicKey || !wallet || !wallet.adapter || isLoading}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              {isLoading ? (
                <>
                  <Loader size={20} className="animate-spin" />
                  Creating Tokens...
                </>
              ) : (
                <>
                  <Coins size={20} />
                  Create Tokens and Accounts
                </>
              )}
            </button>
          </div>

          {/* Status */}
          {status && (
            <div className={`mt-6 p-4 rounded-lg flex items-start gap-3 ${
              status.includes('Error') 
                ? 'bg-red-50 border border-red-200' 
                : status.includes('Success') 
                ? 'bg-green-50 border border-green-200'
                : 'bg-blue-50 border border-blue-200'
            }`}>
              {status.includes('Error') ? (
                <AlertCircle size={20} className="text-red-500 mt-0.5 flex-shrink-0" />
              ) : status.includes('Success') ? (
                <CheckCircle size={20} className="text-green-500 mt-0.5 flex-shrink-0" />
              ) : (
                <Loader size={20} className="text-blue-500 mt-0.5 flex-shrink-0 animate-spin" />
              )}
              <p className={`text-sm ${
                status.includes('Error') 
                  ? 'text-red-700' 
                  : status.includes('Success') 
                  ? 'text-green-700'
                  : 'text-blue-700'
              }`}>
                {status}
              </p>
            </div>
          )}

          {/* Results */}
          {(tokenAMint || tokenBMint) && (
            <div className="mt-6 space-y-4">
              {tokenAMint && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-semibold text-blue-800 mb-2">Token A Created</h4>
                  <div className="space-y-1 text-sm">
                    <p><span className="font-medium">Mint:</span> <code className="bg-white px-2 py-1 rounded text-xs">{tokenAMint}</code></p>
                    <p><span className="font-medium">Account:</span> <code className="bg-white px-2 py-1 rounded text-xs">{tokenAAccount}</code></p>
                  </div>
                </div>
              )}
              
              {tokenBMint && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <h4 className="font-semibold text-purple-800 mb-2">Token B Created</h4>
                  <div className="space-y-1 text-sm">
                    <p><span className="font-medium">Mint:</span> <code className="bg-white px-2 py-1 rounded text-xs">{tokenBMint}</code></p>
                    <p><span className="font-medium">Account:</span> <code className="bg-white px-2 py-1 rounded text-xs">{tokenBAccount}</code></p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
