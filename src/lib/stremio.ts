/**
 * Personalized Stremio addon config (map #109, #113): the stremio_configs row
 * (lazily provisioned on first /configure visit), its per-catalog config JSON,
 * and token regeneration. The defaults/merge logic is imported from the
 * Worker's personal.ts — one implementation, so the page always shows exactly
 * what the addon will serve.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { TokenData } from "../../worker/personal";

export {
  type CatalogDef,
  type CatalogSortKey,
  decodeCatalogs,
  defaultCatalogs,
  encodeCatalogs,
  isRadarSource,
  listIdOfSource,
  parseCatalogs,
} from "../../worker/personal";
export { CATALOGS as RADAR_CATALOGS } from "../../worker/stremio-core";

export type StremioConfig = TokenData["config"];

export interface StremioConfigRow {
  token: string;
  config: StremioConfig;
}

/** A fresh user-added catalog id — short, unique enough per user, and never
 * colliding with the default `list-*`/`*-digital` ids. */
export function newCatalogId(): string {
  return `c-${crypto.randomUUID().slice(0, 8)}`;
}

/** The caller's addon row — null until first provisioned (RLS-scoped).
 * Disabled for anonymous visitors, who have no row and no token (#118). */
export function useStremioConfig(enabled = true) {
  return useQuery({
    queryKey: ["stremio-config"],
    enabled,
    queryFn: async (): Promise<StremioConfigRow | null> => {
      const { data, error } = await supabase
        .from("stremio_configs")
        .select("token, config")
        .maybeSingle();
      if (error) throw error;
      return (data as StremioConfigRow | null) ?? null;
    },
  });
}

/** Lazy provisioning: create the row (the DB generates the token). A 23505
 * means another tab won the race — the refetch picks the row up either way. */
export function useCreateStremioConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const { error } = await supabase
        .from("stremio_configs")
        .insert({ user_id: userData.user.id });
      if (error && error.code !== "23505") throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stremio-config"] }),
  });
}

/** Save the whole config JSON (optimistically — the controls are the source
 * of the change, so the cache can reflect it immediately). */
export function useUpdateStremioConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: StremioConfig) => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const { error } = await supabase
        .from("stremio_configs")
        .update({ config })
        .eq("user_id", userData.user.id);
      if (error) throw error;
    },
    onMutate: async (config) => {
      await qc.cancelQueries({ queryKey: ["stremio-config"] });
      qc.setQueryData<StremioConfigRow | null>(["stremio-config"], (old) =>
        old ? { ...old, config } : old,
      );
    },
    onError: () => qc.invalidateQueries({ queryKey: ["stremio-config"] }),
  });
}

/** Swap the token server-side (the client can't write that column). The old
 * addon URL turns into a dead install — the page warns before calling this. */
export function useRegenerateStremioToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc("stremio_regenerate_token");
      if (error) throw error;
      return data as string;
    },
    onSuccess: (token) => {
      qc.setQueryData<StremioConfigRow | null>(["stremio-config"], (old) =>
        old ? { ...old, token } : old,
      );
    },
  });
}
