// src/lib/categories.ts
import { supabase } from "./supabase";

export type Flow = "income" | "expense";
export type Kind = "fixed" | "variable";

export type Category = {
  id: string;
  household_id: string;
  flow: Flow;
  kind: Kind;
  name: string;
  icon: string | null;
  sort: number;
};

export async function listCategories(householdId: string, flow?: Flow) {
  let q = supabase
    .from("categories")
    .select("id,household_id,flow,kind,name,icon,sort")
    .eq("household_id", householdId)
    .order("sort", { ascending: true })
    .order("name", { ascending: true });

  if (flow) q = q.eq("flow", flow);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Category[];
}

export async function createCategory(params: {
  householdId: string;
  flow: Flow;
  kind: Kind;
  name: string;
  icon?: string | null;
  sort?: number;
}) {
  const { data, error } = await supabase
    .from("categories")
    .insert({
      household_id: params.householdId,
      flow: params.flow,
      kind: params.kind,
      name: params.name,
      icon: params.icon ?? null,
      sort: params.sort ?? 0,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as Category;
}

export async function seedDefaultCategories(householdId: string) {
  const { data: exists } = await supabase.from("categories").select("id").eq("household_id", householdId).limit(1);
  if (exists && exists.length) return;

  const defaults: Array<Omit<Category, "id" | "household_id">> = [
    // INCOME
    { flow: "income", kind: "fixed", name: "Salário", icon: "cash-outline", sort: 10 },
    { flow: "income", kind: "variable", name: "Extra (Uber, bico)", icon: "rocket-outline", sort: 20 },
    { flow: "income", kind: "variable", name: "Pix recebido", icon: "swap-horizontal-outline", sort: 30 },
    { flow: "income", kind: "variable", name: "PLR / Bônus", icon: "gift-outline", sort: 40 },

    // EXPENSE (fixed)
    { flow: "expense", kind: "fixed", name: "Aluguel / Financiamento", icon: "home-outline", sort: 110 },
    { flow: "expense", kind: "fixed", name: "Internet / Celular", icon: "wifi-outline", sort: 120 },
    { flow: "expense", kind: "fixed", name: "Energia / Água", icon: "flash-outline", sort: 130 },
    { flow: "expense", kind: "fixed", name: "Assinaturas", icon: "tv-outline", sort: 140 },

    // EXPENSE (variable)
    { flow: "expense", kind: "variable", name: "Alimentação", icon: "restaurant-outline", sort: 210 },
    { flow: "expense", kind: "variable", name: "Transporte", icon: "car-outline", sort: 220 },
    { flow: "expense", kind: "variable", name: "Saúde", icon: "medkit-outline", sort: 230 },
    { flow: "expense", kind: "variable", name: "Lazer", icon: "game-controller-outline", sort: 240 },
    { flow: "expense", kind: "variable", name: "Compras", icon: "cart-outline", sort: 250 },
  ];

  const payload = defaults.map((c) => ({ ...c, household_id: householdId }));
  await supabase.from("categories").insert(payload);
}
