-- The AMC GST rate stops being a constant in the source, and becomes a field a
-- person types on the contract.
--
-- Nullable with NO default, on purpose: the client's instruction is that the
-- tax on an AMC is entered by hand. Existing contracts arrive with null, which
-- reads as "nobody has entered a rate yet" - `raiseAmcInvoice` refuses those
-- until somebody does, rather than billing them at an assumed 18%.
ALTER TABLE "AmcContract" ADD COLUMN     "sacCode" TEXT,
ADD COLUMN     "taxRatePct" DECIMAL(5,2);
