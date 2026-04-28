// AI Payment Guardian - Content Script

let isProcessing = false;
let currentTarget = null;
let allowNextClick = false;

// Keywords to trigger interception
const PAYMENT_KEYWORDS = [
  'pay', 'pay now', 'proceed to payment', 'checkout', 'buy now', 'place order', 'complete purchase',
  'choose plan', 'claim deal', 'add to cart', 'select plan', 'subscribe', 'continue to payment',
  'make payment', 'order now'
];

function isPaymentElement(el) {
  if (!el) return false;
  
  const text = (el.innerText || '').trim().toLowerCase();
  const attrStr = ((el.id || '') + ' ' + (el.className || '') + ' ' + (el.name || '')).toLowerCase();
  
  // 1. Direct Keyword Match in Text
  const hasKeyword = PAYMENT_KEYWORDS.some(keyword => text === keyword || (text.includes(keyword) && text.length < 40));
  if (hasKeyword) return true;

  // 2. Specific "Continue" logic (often used in carts)
  if (text === 'continue' || text === 'next') {
    if (attrStr.includes('checkout') || attrStr.includes('payment') || attrStr.includes('cart')) return true;
  }

  // 3. Attribute-based signals for buttons/links
  if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') {
    const isPaymentAttr = attrStr.includes('checkout') || 
                         attrStr.includes('payment') || 
                         attrStr.includes('buy-now') || 
                         attrStr.includes('add-to-cart');
    
    if (isPaymentAttr && text.length < 50) return true;
  }
  
  // 4. Input type submit/button
  if (el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button')) {
    const val = (el.value || '').trim().toLowerCase();
    return PAYMENT_KEYWORDS.some(keyword => val.includes(keyword) && val.length < 30);
  }

  return false;
}

// Intercept clicks during capture phase
document.addEventListener('click', (e) => {
  if (allowNextClick) {
    allowNextClick = false;
    return; // Let it pass
  }

  // 1. Synchronously find the payment element
  let target = e.target;
  let paymentEl = null;

  while (target && target !== document.body) {
    if (isPaymentElement(target)) {
      paymentEl = target;
      break;
    }
    target = target.parentElement;
  }

  // 2. If it's a payment element, stop it IMMEDIATELY and SYNCHRONOUSLY
  if (paymentEl && !isProcessing) {
    e.preventDefault();
    e.stopImmediatePropagation();
    
    // 3. Now handle the async logic (checking settings and analysis)
    handlePaymentInterception(paymentEl);
  }
}, true);

async function handlePaymentInterception(paymentEl) {
  // Check if extension is enabled
  const result = await chrome.storage.local.get(['aipg_enabled']);
  
  if (result.aipg_enabled === false) {
    // If disabled, just proceed with the original click
    isProcessing = false;
    currentTarget = paymentEl;
    proceedWithClick();
    return;
  }

  isProcessing = true;
  currentTarget = paymentEl;
  startVerification();
}

function extractPageData() {
  // Try to find merchant name
  let merchantName = document.title.split('-')[0].trim();
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName) merchantName = ogSiteName.content;

  // Extract visible text (limit to 1500 chars for prompt limits)
  const visibleText = document.body.innerText.replace(/\s+/g, ' ').substring(0, 1500);

  // Look for payment gateway clues
  const htmlStr = document.documentElement.innerHTML.toLowerCase();
  let paymentInfo = [];
  if (htmlStr.includes('stripe.com')) paymentInfo.push('Stripe');
  if (htmlStr.includes('paypal.com')) paymentInfo.push('PayPal');
  if (htmlStr.includes('razorpay.com')) paymentInfo.push('Razorpay');
  if (htmlStr.includes('upi')) paymentInfo.push('UPI');

  return {
    merchant_name: merchantName,
    domain: window.location.hostname,
    page_title: document.title,
    visible_text: visibleText,
    payment_info: paymentInfo.join(', ') || 'Unknown'
  };
}

function startVerification() {
  injectOverlay();
  updateOverlayState('loading', null);

  const data = extractPageData();

  chrome.runtime.sendMessage({ action: 'analyze_risk', data }, (response) => {
    isProcessing = false;
    
    if (chrome.runtime.lastError || !response || response.error) {
      console.error('AIPG Error:', chrome.runtime.lastError || response?.error);
      updateOverlayState('error', { explanation: 'Failed to verify transaction. Please check your API key.' });
      return;
    }

    handleDecision(response);
  });
}

function handleDecision(result) {
  // result = { risk_score, risk_level, is_suspicious, key_issues, explanation, recommended_action }
  
  if (result.risk_score > 75 || result.recommended_action === 'block') {
    updateOverlayState('blocked', result);
  } else if (result.risk_score >= 50) {
    updateOverlayState('warning', result);
  } else {
    // Safe
    updateOverlayState('safe', result);
    // Auto-proceed after short delay
    setTimeout(() => {
      closeOverlay();
      proceedWithClick();
    }, 1500);
  }
}

function proceedWithClick() {
  if (currentTarget) {
    allowNextClick = true;
    currentTarget.click();
    currentTarget = null;
  }
}

/* UI Injection and Management */

function injectOverlay() {
  if (document.getElementById('aipg-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'aipg-overlay';
  
  overlay.innerHTML = `
    <div class="aipg-modal">
      <div class="aipg-header">
        <span class="aipg-header-icon">🛡️</span>
        <h2 class="aipg-header-title">Payment Guardian</h2>
      </div>
      
      <div class="aipg-body">
        <div class="aipg-status">
          <div class="aipg-score" id="aipg-score-display">--</div>
          <div class="aipg-level" id="aipg-level-display">Verifying Merchant...</div>
        </div>
        
        <div id="aipg-details" class="aipg-hidden">
          <div class="aipg-explanation" id="aipg-explanation"></div>
          <div class="aipg-issues-title">Key Findings</div>
          <ul class="aipg-issues-list" id="aipg-issues"></ul>
        </div>
      </div>
      
      <div class="aipg-footer">
        <button class="aipg-btn aipg-btn-secondary aipg-hidden" id="aipg-btn-cancel">Cancel</button>
        <button class="aipg-btn aipg-btn-danger aipg-hidden" id="aipg-btn-proceed">Proceed Anyway</button>
        <button class="aipg-btn aipg-btn-primary aipg-hidden" id="aipg-btn-close">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Setup event listeners
  document.getElementById('aipg-btn-cancel').addEventListener('click', closeOverlay);
  document.getElementById('aipg-btn-close').addEventListener('click', closeOverlay);
  document.getElementById('aipg-btn-proceed').addEventListener('click', () => {
    closeOverlay();
    proceedWithClick();
  });

  // Small delay to allow CSS transition
  requestAnimationFrame(() => {
    overlay.classList.add('aipg-show');
  });
}

function closeOverlay() {
  const overlay = document.getElementById('aipg-overlay');
  if (overlay) {
    overlay.classList.remove('aipg-show');
    setTimeout(() => {
      overlay.remove();
      isProcessing = false;
    }, 300);
  }
}

function updateOverlayState(state, data) {
  const overlay = document.getElementById('aipg-overlay');
  if (!overlay) return;

  const modal = overlay.querySelector('.aipg-modal');
  modal.className = `aipg-modal aipg-state-${state}`;

  const scoreEl = document.getElementById('aipg-score-display');
  const levelEl = document.getElementById('aipg-level-display');
  const detailsEl = document.getElementById('aipg-details');
  const expEl = document.getElementById('aipg-explanation');
  const issuesEl = document.getElementById('aipg-issues');
  
  const btnCancel = document.getElementById('aipg-btn-cancel');
  const btnProceed = document.getElementById('aipg-btn-proceed');
  const btnClose = document.getElementById('aipg-btn-close');

  // Reset buttons
  btnCancel.classList.add('aipg-hidden');
  btnProceed.classList.add('aipg-hidden');
  btnClose.classList.add('aipg-hidden');

  if (state === 'loading') {
    scoreEl.textContent = '🔍';
    levelEl.textContent = 'Analyzing Risk...';
    detailsEl.classList.add('aipg-hidden');
  } 
  else if (state === 'error') {
    scoreEl.textContent = '⚠️';
    levelEl.textContent = 'Analysis Failed';
    detailsEl.classList.remove('aipg-hidden');
    expEl.textContent = data.explanation;
    issuesEl.innerHTML = '';
    btnClose.classList.remove('aipg-hidden');
  }
  else {
    scoreEl.textContent = data.risk_score;
    levelEl.textContent = `${data.risk_level} Risk`;
    
    detailsEl.classList.remove('aipg-hidden');
    expEl.textContent = data.explanation;
    
    issuesEl.innerHTML = '';
    if (data.key_issues && Array.isArray(data.key_issues)) {
      data.key_issues.forEach(issue => {
        const li = document.createElement('li');
        li.textContent = issue;
        issuesEl.appendChild(li);
      });
    }

    if (state === 'safe') {
      levelEl.textContent = 'Low Risk (Safe)';
      // Buttons handled by auto-proceed
    } else if (state === 'warning') {
      btnCancel.classList.remove('aipg-hidden');
      btnProceed.classList.remove('aipg-hidden');
    } else if (state === 'blocked') {
      btnClose.classList.remove('aipg-hidden');
    }
  }
}
