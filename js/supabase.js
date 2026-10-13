import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://neirsqgawmmefilovuws.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_NJ0CoYqSXRmOuy6ORdmMhA_4Pn5KPl8";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
