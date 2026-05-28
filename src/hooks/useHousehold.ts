// src/hooks/useHousehold.ts
import { useEffect, useState } from "react";
import { getMyHouseholdId } from "../lib/household";

export function useHouseholdId(userId: string | null) {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function run() {
      if (!userId) {
        setHouseholdId(null);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const hh = await getMyHouseholdId(userId);
        if (alive) setHouseholdId(hh);
      } finally {
        if (alive) setLoading(false);
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, [userId]);

  return { householdId, loading };
}
