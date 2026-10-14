import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Use POST." }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Please sign in first." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } =
      await supabase.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: "Your session is invalid. Sign in again." }, 401);
    }

    const body = await req.json();
    const phone = String(body.phone ?? "").replace(/[\s+\-()]/g, "");

    if (!/^254[17]\d{8}$/.test(phone)) {
      return jsonResponse({
        error: "Enter a valid Kenyan mobile number, e.g. 254712345678.",
      }, 400);
    }

    const consumerKey = Deno.env.get("MPESA_CONSUMER_KEY");
    const consumerSecret = Deno.env.get("MPESA_CONSUMER_SECRET");
    const shortcode = Deno.env.get("MPESA_SHORTCODE");
    const passkey = Deno.env.get("MPESA_PASSKEY");
    const environment = Deno.env.get("MPESA_ENVIRONMENT");
    const callbackUrl = Deno.env.get("MPESA_CALLBACK_URL");

    if (
      !consumerKey || !consumerSecret || !shortcode || !passkey ||
      environment !== "sandbox" || !callbackUrl
    ) {
      return jsonResponse({
        error: "M-Pesa configuration is incomplete. Check server secrets.",
      }, 500);
    }

    if (!callbackUrl.startsWith("https://")) {
      return jsonResponse({ error: "The callback URL must use HTTPS." }, 500);
    }

    const baseUrl = "https://sandbox.safaricom.co.ke";
    const credentials = btoa(`${consumerKey}:${consumerSecret}`);

    const tokenResponse = await fetch(
      `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { Authorization: `Basic ${credentials}` },
      },
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Daraja token request failed:", tokenData);
      return jsonResponse({ error: "Could not authenticate with M-Pesa sandbox." }, 502);
    }

    const timestamp = new Date().toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14);

    const password = btoa(`${shortcode}${passkey}${timestamp}`);

    const stkResponse = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: 130,
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: callbackUrl,
        AccountReference: `CRUSHLY-${user.id.slice(0, 8)}`,
        TransactionDesc: "CRUSHLY 10-minute video call",
      }),
    });

    const stkData = await stkResponse.json();

    if (!stkResponse.ok || stkData.ResponseCode !== "0") {
      console.error("STK Push request failed:", stkData);
      return jsonResponse({
        error: "M-Pesa did not accept the payment request. Check the sandbox setup.",
      }, 502);
    }

    // A successful request means the prompt was accepted, NOT that payment succeeded.
    return jsonResponse({
      success: true,
      message: "Payment prompt requested. Check your phone or sandbox test flow.",
      checkoutRequestId: stkData.CheckoutRequestID,
      merchantRequestId: stkData.MerchantRequestID,
      amount: 130,
      currency: "KES",
      paymentStatus: "pending",
    });
  } catch (error) {
    console.error("Payment function error:", error);
    return jsonResponse({ error: "Unexpected payment error." }, 500);
  }
});
