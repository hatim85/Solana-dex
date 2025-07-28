import React, { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount, getMint } from '@solana/spl-token';
import idl from './idl/swap_idl.json';
import { ShoppingCart, RefreshCw, Eye, CheckCircle, AlertCircle, Loader, ArrowRight, X } from 'lucide-react';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplTokenMetadata, fetchDigitalAsset } from '@metaplex-foundation/mpl-token-metadata';
import { publicKey as umiPublicKey } from '@metaplex-foundation/umi';

export const TakeOffer = () => {
  const { publicKey, wallet, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [offers, setOffers] = useState([]);
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTakingOffer, setIsTakingOffer] = useState(false);

  const validatePublicKey = (key, context) => {
    try {
      new PublicKey(key);
      return true;
    } catch (error) {
      console.error(`Invalid public key in ${context}:`, { key, error });
      return false;
    }
  };

  const fetchOffers = async () => {
    if (!publicKey || !wallet || !signTransaction) {
      setStatus('Please connect your wallet to fetch offers.');
      return;
    }

    setIsRefreshing(true);
    setStatus('Fetching offers...');
    try {
      const provider = new anchor.AnchorProvider(connection, { publicKey, signTransaction, signAllTransactions: wallet.signAllTransactions }, { commitment: 'confirmed' });
      const programId = new PublicKey(idl.address);
      const program = new anchor.Program(idl, provider);
      const umi = createUmi(connection.rpcEndpoint).use(mplTokenMetadata());

      const offerAccounts = await program.account.offer.all();
      console.log(`Fetched ${offerAccounts.length} offer accounts`);

      const parsedOffers = await Promise.all(
        offerAccounts.map(async ({ publicKey, account }) => {
          // Validate all required fields
          if (!account.id || !account.maker || !account.tokenMintA || !account.tokenMintB || !account.tokenAAmount || !account.tokenBWantedAmount) {
            console.error('Invalid offer account missing required fields:', publicKey.toBase58(), {
              id: account.id ? account.id.toString() : 'missing',
              maker: account.maker ? account.maker.toBase58() : 'missing',
              tokenMintA: account.tokenMintA ? account.tokenMintA.toBase58() : 'missing',
              tokenMintB: account.tokenMintB ? account.tokenMintB.toBase58() : 'missing',
              tokenAAmount: account.tokenAAmount ? account.tokenAAmount.toString() : 'missing',
              tokenBWantedAmount: account.tokenBWantedAmount ? account.tokenBWantedAmount.toString() : 'missing',
            });
            return null;
          }

          console.log('Raw Offer Account:', {
            publicKey: publicKey.toBase58(),
            account: {
              id: account.id.toString(),
              maker: account.maker.toBase58(),
              tokenMintA: account.tokenMintA.toBase58(),
              tokenMintB: account.tokenMintB.toBase58(),
              tokenAAmount: account.tokenAAmount.toString(),
              tokenBWantedAmount: account.tokenBWantedAmount.toString(),
            },
          });

          let tokenADecimals = 9;
          let tokenBDecimals = 9;
          let tokenAName = 'Token A';
          let tokenBName = 'Token B';

          try {
            const mintAInfo = await getMint(connection, new PublicKey(account.tokenMintA));
            tokenADecimals = mintAInfo.decimals;
            const mintBInfo = await getMint(connection, new PublicKey(account.tokenMintB));
            tokenBDecimals = mintBInfo.decimals;

            const assetA = await fetchDigitalAsset(umi, umiPublicKey(account.tokenMintA.toBase58()));
            tokenAName = assetA.metadata.name || 'Token A';
            const assetB = await fetchDigitalAsset(umi, umiPublicKey(account.tokenMintB.toBase58()));
            tokenBName = assetB.metadata.name || 'Token B';
          } catch (error) {
            console.error('Error fetching mint or metadata for offer:', publicKey.toBase58(), error);
          }

          let tokenAAmount, tokenBWantedAmount;
          try {
            tokenAAmount = account.tokenAAmount.div(new anchor.BN(10 ** tokenADecimals)).toNumber();
            tokenBWantedAmount = account.tokenBWantedAmount.div(new anchor.BN(10 ** tokenBDecimals)).toNumber();
          } catch (error) {
            console.error('Error converting amounts for offer:', {
              offerPda: publicKey.toBase58(),
              tokenAAmount: account.tokenAAmount.toString(),
              tokenBWantedAmount: account.tokenBWantedAmount.toString(),
              error,
            });
            return null;
          }

          if (isNaN(tokenAAmount) || isNaN(tokenBWantedAmount)) {
            console.warn('Skipping invalid offer with NaN amounts:', {
              offerPda: publicKey.toBase58(),
              tokenAAmount: account.tokenAAmount.toString(),
              tokenBWantedAmount: account.tokenBWantedAmount.toString(),
            });
            return null;
          }

          return {
            offerPda: publicKey.toBase58(),
            offerId: account.id.toString(),
            maker: account.maker.toBase58(),
            tokenMintA: account.tokenMintA.toBase58(),
            tokenMintB: account.tokenMintB.toBase58(),
            tokenAAmount,
            tokenBWantedAmount,
            tokenAName,
            tokenBName,
          };
        })
      );

      const validOffers = parsedOffers.filter((offer) => offer !== null);
      console.log(`Processed ${validOffers.length} valid offers out of ${offerAccounts.length}`);
      setOffers(validOffers);
      setStatus(validOffers.length > 0 ? `Found ${validOffers.length} offers` && setIsLoading(false) : 'No offers found.' && setIsLoading(false));
    } catch (error) {
      setStatus(`Error fetching offers: ${error.message || 'An unexpected error occurred.'}`);
      console.error('Error in fetchOffers:', error);
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (publicKey && wallet && signTransaction) {
      setIsLoading(true);
      fetchOffers();
    }
  }, [publicKey, wallet, signTransaction]);

  const handleTakeOffer = async (offer) => {
    if (isTakingOffer) return;
    setIsTakingOffer(true);
    setIsModalOpen(false);
    setStatus('Taking offer...');

    if (!publicKey || !wallet || !signTransaction) {
      setStatus('Please connect your wallet.');
      setIsTakingOffer(false);
      return;
    }

    try {
      const provider = new anchor.AnchorProvider(connection, { publicKey, signTransaction, signAllTransactions: wallet.signAllTransactions }, { commitment: 'confirmed' });
      const programId = new PublicKey(idl.address);
      const program = new anchor.Program(idl, provider);

      const offerIdBN = new anchor.BN(offer.offerId);
      const [offerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('offer'), new PublicKey(offer.maker).toBuffer(), offerIdBN.toArrayLike(Buffer, 'le', 8)],
        programId
      );

      const vault = await getAssociatedTokenAddress(new PublicKey(offer.tokenMintA), offerPda, true);
      const takerTokenAccountA = await getAssociatedTokenAddress(new PublicKey(offer.tokenMintA), publicKey);
      const takerTokenAccountB = await getAssociatedTokenAddress(new PublicKey(offer.tokenMintB), publicKey);
      const makerTokenAccountB = await getAssociatedTokenAddress(new PublicKey(offer.tokenMintB), new PublicKey(offer.maker));

      const takerTokenAccountAInfo = await connection.getAccountInfo(takerTokenAccountA);
      let transaction = new Transaction();

      if (!takerTokenAccountAInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            takerTokenAccountA,
            publicKey,
            new PublicKey(offer.tokenMintA)
          )
        );
      }

      const takeOfferIx = await program.methods
        .takeOffer()
        .accounts({
          taker: publicKey,
          maker: new PublicKey(offer.maker),
          tokenMintA: new PublicKey(offer.tokenMintA),
          tokenMintB: new PublicKey(offer.tokenMintB),
          takerTokenAccountA,
          takerTokenAccountB,
          makerTokenAccountB,
          offer: offerPda,
          vault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .instruction();

      transaction.add(takeOfferIx);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signedTx = await signTransaction(transaction);
      const txSig = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: false });
      console.log('✅ Transaction Signature:', txSig);

      await connection.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, 'confirmed');

      setStatus(`✅ Offer taken successfully. [View on Explorer](https://explorer.solana.com/tx/${txSig}?cluster=devnet)`);
      setTimeout(() => fetchOffers(), 2000);
    } catch (error) {
      console.error('❌ Error in handleTakeOffer:', error);
      setStatus(`Error: ${error.message || 'An unexpected error occurred.'}`);

      if (error.getLogs) {
        try {
          const logs = await error.getLogs();
          console.error('Transaction Logs:', logs);
        } catch (logErr) {
          console.warn('Could not retrieve logs:', logErr);
        }
      }
    } finally {
      setIsTakingOffer(false);
    }
  };

  const openModal = (offer) => {
    setSelectedOffer(offer);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setSelectedOffer(null);
    setIsModalOpen(false);
  };

  const truncateAddress = (address, start = 4, end = 4) => {
    if (!address) return '';
    return `${address.slice(0, start)}...${address.slice(-end)}`;
  };

  return (
    <div className="max-w-6xl mx-auto min-h-screen">
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
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <ShoppingCart size={28} />
                Take Offer
              </h2>
              <p className="text-purple-100 mt-1">Browse and accept token swap offers</p>
            </div>
            <button
              onClick={fetchOffers}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors duration-200 disabled:opacity-50"
            >
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader size={32} className="animate-spin text-purple-600" />
              <span className="ml-3 text-gray-600">Loading offers...</span>
            </div>
          ) : offers.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart size={48} className="mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-semibold text-gray-600 mb-2">No offers available</h3>
              <p className="text-gray-500">Check back later or create your own offer!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Offer ID</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Maker</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Offering</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Wanting</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map((offer) => (
                    <tr key={offer.offerPda} className="border-b border-gray-100 hover:bg-gray-50 transition-colors duration-150">
                      <td className="py-4 px-4">
                        <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                          #{offer.offerId}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                          {truncateAddress(offer.maker)}
                        </code>
                      </td>
                      <td className="py-4 px-4">
                        <div className="space-y-1">
                          <div className="font-semibold text-green-600">
                            {offer.tokenAAmount.toFixed(2)} {offer.tokenAName}
                          </div>
                          <div className="text-xs text-gray-500">
                            {truncateAddress(offer.tokenMintA)}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="space-y-1">
                          <div className="font-semibold text-blue-600">
                            {offer.tokenBWantedAmount.toFixed(2)} {offer.tokenBName}
                          </div>
                          <div className="text-xs text-gray-500">
                            {truncateAddress(offer.tokenMintB)}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex gap-2">
                          <button
                            onClick={() => openModal(offer)}
                            className="flex items-center gap-1 px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg text-sm transition-colors duration-200"
                          >
                            <Eye size={16} />
                            View
                          </button>
                          <button
                            onClick={() => handleTakeOffer(offer)}
                            disabled={!publicKey || !wallet || !signTransaction || isTakingOffer}
                            className="flex items-center gap-1 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <ShoppingCart size={16} />
                            {isTakingOffer ? "Processing..." : "Take"}
                          </button>

                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {status && (
            <div className={`mt-6 p-4 rounded-lg flex items-start gap-3 ${status.includes('Error')
                ? 'bg-red-50 border border-red-200'
                : status.includes('successfully')
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-blue-50 border border-blue-200'
              }`}>
              {status.includes('Error') ? (
                <AlertCircle size={20} className="text-red-500 mt-0.5 flex-shrink-0" />
              ) : status.includes('successfully') ? (
                <CheckCircle size={20} className="text-green-500 mt-0.5 flex-shrink-0" />
              ) : (
                <Loader size={20} className="text-blue-500 mt-0.5 flex-shrink-0 animate-spin" />
              )}
              <p className={`text-sm ${status.includes('Error')
                  ? 'text-red-700'
                  : status.includes('successfully')
                    ? 'text-green-700'
                    : 'text-blue-700'
                }`}>
                {status}
              </p>
            </div>
          )}
        </div>
      </div>

      {isModalOpen && selectedOffer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4 flex justify-between items-center">
              <h3 className="text-xl font-bold text-white">Offer Details</h3>
              <button
                onClick={closeModal}
                className="text-white hover:bg-white/20 p-1 rounded-lg transition-colors duration-200"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-gray-800 mb-2">Offer #{selectedOffer.offerId}</h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium text-gray-600">Maker:</span>
                    <code className="ml-2 bg-white px-2 py-1 rounded text-xs">{selectedOffer.maker}</code>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-center">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex-1">
                  <h5 className="font-semibold text-green-800 mb-2">You'll Receive</h5>
                  <div className="text-2xl font-bold text-green-600 mb-1">
                    {selectedOffer.tokenAAmount.toFixed(2)} {selectedOffer.tokenAName}
                  </div>
                  <code className="text-xs bg-white px-2 py-1 rounded mt-2 block">
                    {truncateAddress(selectedOffer.tokenMintA, 6, 6)}
                  </code>
                </div>

                <div className="mx-4">
                  <ArrowRight size={24} className="text-gray-400" />
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex-1">
                  <h5 className="font-semibold text-blue-800 mb-2">You'll Send</h5>
                  <div className="text-2xl font-bold text-blue-600 mb-1">
                    {selectedOffer.tokenBWantedAmount.toFixed(2)} {selectedOffer.tokenBName}
                  </div>
                  <code className="text-xs bg-white px-2 py-1 rounded mt-2 block">
                    {truncateAddress(selectedOffer.tokenMintB, 6, 6)}
                  </code>
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-800">
                  <strong>Important:</strong> Make sure you have sufficient Token B balance and that this trade is acceptable to you. This action cannot be undone.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={closeModal}
                  className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleTakeOffer(selectedOffer)}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg font-medium transition-all duration-200"
                >
                  Confirm Trade
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};