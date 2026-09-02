function batchNumber(value) {
  const match = /^B(\d+)$/i.exec(String(value || ""));
  return match ? Number(match[1]) : null;
}

export function nextBatchId(previousRunData = null) {
  const candidates = [
    previousRunData?.stage4?.current_batch,
    ...(previousRunData?.batches || []).map((batch) => batch?.batch_id),
    ...(previousRunData?.stage4?.batches || []).map((batch) => batch?.batch_id),
  ].map(batchNumber).filter(Number.isInteger);
  const next = candidates.length ? Math.max(...candidates) + 1 : 1;
  return `B${String(next).padStart(2, "0")}`;
}

export function batchPurpose(batchId) {
  return batchId === "B01" ? "initial_asset_map" : "incremental_asset_map";
}

