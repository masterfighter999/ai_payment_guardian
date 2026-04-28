// AI Payment Guardian - Background Script

// In-memory cache for the session
const riskCache = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyze_risk') {
    handleRiskAnalysis(request.data)
      .then(sendResponse)
      .catch(error => {
        console.error('Analysis error:', error);
        sendResponse({ error: error.message });
      });
    return true; // Indicates asynchronous response
  }
});

async function handleRiskAnalysis(pageData) {
  const { domain } = pageData;

  // Check cache first (debounce/cache per domain for session)
  if (riskCache.has(domain)) {
    return riskCache.get(domain);
  }

  // Get API key
  const { aipg_api_key } = await chrome.storage.local.get(['aipg_api_key']);
  if (!aipg_api_key) {
    throw new Error('API Key not found. Please set it in the extension popup.');
  }

  // Call Gemini API
  const result = await callGeminiAPI(pageData, aipg_api_key);

  // Cache the result
  riskCache.set(domain, result);

  return result;
}

async function callGeminiAPI(pageData, apiKey) {
  const model = 'gemini-3-flash-preview';

  const systemInstruction = `You are an AI security analyst designed to protect users from online payment fraud, scam merchants, phishing attempts, and deceptive checkout flows.

Your task is to analyze a payment scenario BEFORE a transaction is completed and determine its risk level.

You must:
- prioritize user safety over convenience
- minimize false negatives (missing scams is worse than false alarms)
- use the Google Search tool to search for "[Merchant Name/Domain] scam reddit" or similar queries to find real-time user reports.
- be concise and structured
- return ONLY valid JSON

--------------------------------------------------
ANALYSIS FRAMEWORK:

1. SCAM PATTERNS
- urgency (e.g. "act now", "limited time")
- fear tactics ("account suspended")
- reward bait ("you won", "free gift")

2. MERCHANT LEGITIMACY
- unknown or suspicious domain
- mismatch between brand name and domain
- lack of identifiable business presence

3. PAYMENT RISKS
- direct UPI/payment requests without trusted gateway
- unknown payment processors
- suspicious redirects

4. TRUST SIGNALS
- poor grammar or spelling
- vague or missing company info
- no contact details

5. TECHNICAL SIGNALS
- uncommon TLDs (.xyz, .top, .click)
- inconsistent branding
- excessive redirects

--------------------------------------------------
SCORING LOGIC:

- risk_score: integer (0–100)
- 0–30 → low risk
- 31–60 → medium risk
- 61–100 → high risk

Bias toward caution:
If uncertain, increase risk.

--------------------------------------------------
OUTPUT FORMAT (STRICT JSON):

{
  "risk_score": number,
  "risk_level": "low" | "medium" | "high",
  "is_suspicious": true | false,
  "key_issues": ["string"],
  "explanation": "max 2 sentences",
  "recommended_action": "allow" | "warn" | "block"
}

--------------------------------------------------
RULES:

- DO NOT output anything except JSON
- DO NOT include markdown
- DO NOT include explanations outside JSON
- Keep explanation short and clear
- key_issues must be specific (not generic)

--------------------------------------------------
EXAMPLES:

Input:
Merchant: Fast Prize Hub
Domain: win-prize-fast.top
Text: "Congratulations! You have won a reward. Pay ₹99 to claim now!"
Payment: UPI: reward@upi

Output:
{
  "risk_score": 90,
  "risk_level": "high",
  "is_suspicious": true,
  "key_issues": [
    "Reward bait scam pattern",
    "Urgency pressure",
    "Suspicious domain (.top)",
    "Direct UPI payment request"
  ],
  "explanation": "The content uses reward bait and urgency tactics with an unverified domain, indicating high scam risk.",
  "recommended_action": "block"
}

--------------------------------------------------
Always respond with JSON only.`;

  const userMessage = `Domain: ${pageData.domain}
Merchant Name: ${pageData.merchant_name}
Page Title: ${pageData.page_title}
Payment Info Found: ${pageData.payment_info}
Visible Text Snippet: ${pageData.visible_text}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;

    const payload = {
      model: model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.1
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    let textResponse = data.choices?.[0]?.message?.content;

    if (!textResponse) throw new Error('Empty response from API');

    // Clean up markdown if present
    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();

    return JSON.parse(textResponse);
  } catch (err) {
    throw new Error(`Failed to analyze risk: ${err.message}`);
  }
}

