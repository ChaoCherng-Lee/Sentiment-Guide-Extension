import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * The parent's connection, or null when the site was built without a
 * project. The anon key is public by design: the database rules decide what
 * each signed-in parent can read (only their linked children's counts).
 */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
