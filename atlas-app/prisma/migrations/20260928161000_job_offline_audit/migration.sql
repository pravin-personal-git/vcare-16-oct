-- Audit trigger for the offline receipts table (every table carries one).
DROP TRIGGER IF EXISTS atlas_audit ON "JobOfflineReceipt";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "JobOfflineReceipt" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
