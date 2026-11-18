/* One inquiry dialog, one privacy dialog, one consent-gated delivery handler. */
(() => {
  'use strict';
  const config = window.ATTY_LEO_INQUIRIES || {};
  const VERSION = '2026-11-13-v3';
  const inquiry = document.getElementById('contact-popover');
  const privacy = document.getElementById('privacy-dialog');
  const category = document.getElementById('inquiry-category');
  const agree = privacy.querySelector('[data-privacy-agree]');
  const states = new Map();
  let inquiryOpener, privacyOpener, privacyState, widgetScript;
  const today = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  function endpoint() {
    if (!config.enabled || !config.privacyReviewed || config.privacyVersion !== VERSION ||
        !config.turnstileSiteKey || location.protocol !== 'https:') return null;
    try {
      const url = new URL(config.endpoint || '', location.href);
      return url.origin === location.origin && url.pathname === '/api/inquiries' && !url.search && !url.hash ? url.href : null;
    } catch { return null; }
  }
  const available = Boolean(endpoint());
  // Only an opaque receipt reference survives reload. Never persist answers or consent.
  const recoveryKey = kind => 'atty-leo-receipt-v1:' + kind;
  const receiptLabel = result => (result.entryCode ? 'Entry Code: ' + result.entryCode + '. ' : '') + 'Reference: ' + result.reference;
  function remember(state, reference) {
    state.recoveryReference = reference || '';
    try { if (reference) sessionStorage.setItem(recoveryKey(state.kind), reference);
      else sessionStorage.removeItem(recoveryKey(state.kind)); } catch { /* Storage may be unavailable. */ }
    if (state.recoveryButton) state.recoveryButton.hidden = !reference;
    if (state.separateButton) state.separateButton.hidden = !reference;
  }
  const validPhone = value => /^\+?[\d() .-]{7,30}$/.test(value.trim()) && (value.match(/\d/g) || []).length >= 7;
  const visible = element => element?.isConnected && element.getClientRects().length && !element.closest('[inert]');
  function focus(element) { if (visible(element)) element.focus({ preventScroll: true }); }
  function activeState() { return states.get(category.value); }
  function openPrivacy(state, opener) {
    if (!state || state.busy) return;
    privacyState = state; privacyOpener = opener;
    agree.disabled = privacy.querySelector('[data-notice-version]').textContent.trim() !== VERSION;
    if (!privacy.open) privacy.showModal();
    sync(state); focus(document.getElementById('privacy-title'));
    // Reset the visible scroll container after native modal focus/layout.
    // Setting scrollTop while the dialog is hidden can preserve its old offset.
    privacy.querySelector('.privacy-notice-body').scrollTop = 0;
  }
  function withdrawConsent(state) {
    state.consent = false; state.noticeOpened = false; state.consentVersion = ''; state.withdrawn = true;
    state.error.textContent = ''; sync(state);
  }
  // Keep boundary Tab navigation inside the top modal, including its scrollable notice region.
  for (const dialog of [inquiry, privacy]) dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || (privacy.open && dialog !== privacy)) return;
    const controls = [...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])')].filter(visible);
    if (!controls.length) return;
    const first = controls[0], last = controls.at(-1), current = document.activeElement;
    if (event.shiftKey && (current === first || !controls.includes(current))) { event.preventDefault(); focus(last); }
    else if (!event.shiftKey && (current === last || !controls.includes(current))) { event.preventDefault(); focus(first); }
  });
  function loadWidget() {
    if (window.turnstile) return Promise.resolve();
    if (!widgetScript) widgetScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.onload = resolve;
      script.onerror = () => { widgetScript = null; script.remove(); reject(new Error('Bot verification could not load. Close and reopen the inquiry to retry.')); };
      document.head.append(script);
    });
    return widgetScript;
  }
  async function ensureWidget(state) {
    if (!state || !available || state.widget !== undefined) return;
    try {
      await loadWidget();
      if (state.widget !== undefined || activeState() !== state || !inquiry.open) return;
      state.widget = window.turnstile.render(state.form.querySelector('[data-verification]'), {
        sitekey: config.turnstileSiteKey, action: 'inquiry', size: 'compact',
        callback: token => { state.token = token; sync(state); },
        'expired-callback': () => { state.token = ''; sync(state); },
        'error-callback': () => { state.token = ''; state.error.textContent = 'Verification failed. Please retry verification or contact Atty. Leo.'; sync(state); }
      });
    } catch (e) { state.error.textContent = e.message; }
  }
  function syncContact(state) {
    const method = state.form.elements.contactMethod.value;
    const input = state.form.elements.contactDetails;
    input.type = method === 'Phone' ? 'tel' : 'email';
    input.autocomplete = method === 'Phone' ? 'tel' : 'email';
    input.placeholder = method === 'Phone' ? 'e.g., +63 900 000 0000' : 'you@example.com';
    input.removeAttribute('pattern');
  }
  function sync(state) {
    const form = state.form;
    const confirmed = state.noticeOpened && state.consent && state.consentVersion === VERSION;
    state.checkbox.disabled = state.busy;
    state.checkbox.removeAttribute('aria-readonly');
    state.checkbox.checked = confirmed;
    form.querySelector('.consent-panel').dataset.consentValid = String(confirmed);
    form.querySelector('[data-consent-title]').textContent = confirmed ? 'Privacy consent accepted' : 'Privacy consent required';
    const input = form.elements.contactDetails;
    const contact = input.value.trim();
    input.setCustomValidity(!contact ? '' : form.elements.contactMethod.value === 'Phone'
      ? (validPhone(contact) ? '' : 'Enter a valid phone number with at least 7 digits.')
      : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? '' : 'Enter a valid email address.'));
    if (state.kind === 'legacy') {
      const selected = [...form.querySelectorAll('[name="planningInterests"]:checked')];
      const first = form.querySelector('[name="planningInterests"]');
      first.setCustomValidity(selected.length ? '' : 'Select at least one planning interest.');
      document.getElementById('planning-interests-error').textContent = state.interestsTouched && !selected.length ? 'Select at least one planning interest.' : '';
      const other = selected.some(input => input.value === 'Other / exploring');
      document.getElementById('legacy-other-field').hidden = !other;
      form.elements.planningOther.disabled = !other || state.busy;
      const date = form.elements.preferredDate;
      date.min = today();
      date.setCustomValidity(date.value && date.value < today() ? 'Choose today or a future date.' : '');
    }
    if (state.kind === 'financial') {
      window.refreshScheduleBounds();
      const phone = form.elements.phoneNumber;
      phone.setCustomValidity(phone.required && phone.value && !validPhone(phone.value) ? 'Enter a valid phone number.' : '');
    }
    const valid = [...form.elements].every(input => !input.willValidate || input.validity.valid);
    state.button.disabled = state.busy || !valid || !confirmed || !available || !state.token;
    if (state.recoveryButton) state.recoveryButton.disabled = state.busy || !available || !state.token;
    if (state.separateButton) state.separateButton.disabled = state.busy;
    if (state.recoveryReference && !state.requestId) state.button.disabled = true;
    form.querySelector('[data-consent-state]').textContent = confirmed ? 'Untick the checkbox to withdraw consent before submitting.'
      : state.withdrawn ? 'Privacy consent withdrawn. Please review and agree to the Privacy Notice.'
      : 'Please review and agree to the Privacy Notice.';
  }
  function selectCategory(kind) {
    category.value = states.has(kind) ? kind : '';
    for (const panel of inquiry.querySelectorAll('[data-inquiry-panel]')) panel.hidden = panel.dataset.inquiryPanel !== category.value;
    document.getElementById('inquiry-category-status').textContent = category.value
      ? category.options[category.selectedIndex].text + ' form selected.' : 'Choose a category to open its form without leaving this page.';
    const state = activeState();
    if (state) { sync(state); ensureWidget(state); }
  }
  category.addEventListener('change', () => selectCategory(category.value));
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-inquiry]');
    if (trigger) {
      event.preventDefault(); inquiryOpener = trigger;
      document.querySelectorAll('[popover]:popover-open').forEach(popover => popover.hidePopover());
      selectCategory(trigger.dataset.inquiry);
      if (!inquiry.open) inquiry.showModal();
      ensureWidget(activeState()); focus(document.getElementById('inquiry-dialog-title'));
    }
    const notice = event.target.closest('[data-open-privacy]');
    if (notice) {
      event.preventDefault();
      openPrivacy(states.get(notice.closest('form').dataset.deliveryForm), notice);
    }
    if (event.target.closest('[data-privacy-agree]')) {
      const displayedVersion = privacy.querySelector('[data-notice-version]').textContent.trim();
      if (!privacy.open || !privacyState || privacyState.busy || displayedVersion !== VERSION) return;
      // Commit a single in-memory confirmation; no network request or new record on review.
      privacyState.noticeOpened = true;
      privacyState.consent = true;
      privacyState.consentVersion = displayedVersion;
      privacyState.withdrawn = false;
      privacyState.error.textContent = '';
      sync(privacyState); privacy.close();
    }
    const close = event.target.closest('[data-close-dialog]');
    if (close) {
      if (close.dataset.closeDialog === inquiry.id && privacy.open) privacy.close();
      document.getElementById(close.dataset.closeDialog).close();
    }
  });
  // Close only the top layer, including programmatic openings sharing a browser close-watcher group.
  privacy.addEventListener('cancel', event => { event.preventDefault(); privacy.close(); });
  // Consume the whole Escape keypress so the underlying inquiry stays open after notice dismissal.
  let privacyEscape = false;
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && privacy.open) {
      privacyEscape = true; event.preventDefault(); event.stopImmediatePropagation(); privacy.close();
    }
  }, true);
  document.addEventListener('keyup', event => {
    if (event.key === 'Escape' && privacyEscape) {
      privacyEscape = false; event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  privacy.addEventListener('close', () => {
    agree.disabled = true;
    if (privacyState) sync(privacyState);
    if (inquiry.open) focus(privacyOpener);
  });
  inquiry.addEventListener('close', () => {
    if (privacy.open) privacy.close();
    if (visible(inquiryOpener)) focus(inquiryOpener);
    else focus(document.querySelector('#financial-page:not([hidden]) .menu-button'));
  });
  function payloadFor(state) {
    const f = Object.fromEntries(new FormData(state.form));
    const fields = {
      fullName: (f.fullName ?? f.name ?? '').trim(), contactMethod: f.contactMethod,
      contactDetails: f.contactDetails.trim(), questions: f.questions || '', website: f.website || '',
      consent: state.consent && state.consentVersion === VERSION
    };
    if (state.kind === 'opportunity') Object.assign(fields, {
      ageRange: f.ageRange || '', occupation: f.occupation || '', careerInterest: f.careerInterest, priorExperience: f.priorExperience
    });
    if (state.kind === 'legacy') {
      const planningInterests = [...state.form.querySelectorAll('[name="planningInterests"]:checked')].map(input => input.value);
      Object.assign(fields, { planningInterests, planningOther: planningInterests.includes('Other / exploring') ? f.planningOther || '' : '',
        consultationMethod: f.consultationMethod, preferredDate: f.preferredDate || '' });
    }
    if (state.kind === 'financial') {
      Object.assign(fields, { age: f.age, gender: f.gender, need: f.need, industry: f.industry,
        otherNeed: f.need === 'Others' ? f.otherNeed || '' : '', followup: f.followup });
      if (f.followup !== 'Email only') Object.assign(fields, {
        preferredDate: f.preferredDate, preferredHour: f.preferredHour, preferredMinute: f.preferredMinute,
        preferredMeridiem: f.preferredMeridiem, phoneNumber: f.phoneNumber,
        meetingPlace: f.followup === 'Meet in person' ? f.meetingPlace : ''
      });
    }
    return { kind: state.kind, fields, noticeOpened: state.noticeOpened, privacyVersion: state.consentVersion };
  }
  for (const form of inquiry.querySelectorAll('[data-delivery-form]')) {
    const state = { form, kind: form.dataset.deliveryForm, checkbox: form.querySelector('[data-consent]'), consent: false, consentVersion: '', noticeOpened: false, withdrawn: false,
      busy: false, token: '', widget: undefined, interestsTouched: false,
      button: form.querySelector('[type="submit"]'), error: form.querySelector('[data-error]'), status: form.querySelector('[data-status]') };
    states.set(state.kind, state); syncContact(state);
    const recovery = document.createElement('button');
    recovery.type = 'button'; recovery.className = 'privacy-notice-link';
    recovery.textContent = 'Check previous inquiry receipt'; recovery.hidden = true;
    state.status.after(recovery); state.recoveryButton = recovery;
    const separate = document.createElement('button'); separate.type = 'button'; separate.className = 'privacy-notice-link';
    separate.textContent = 'Start a separate inquiry'; separate.hidden = true;
    recovery.after(separate); state.separateButton = separate;
    separate.addEventListener('click', () => {
      if (state.busy || !window.confirm('Only start a separate inquiry for a different request. An earlier inquiry may already be saved. Continue?')) return;
      remember(state, ''); state.requestId = undefined; state.previousPayload = undefined;
      state.status.textContent = 'A separate inquiry will receive a new reference. Your current entries are retained.'; sync(state);
    });
    try {
      const saved = sessionStorage.getItem(recoveryKey(state.kind));
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved || '')) remember(state, saved);
    } catch { /* No browser storage is required for sending. */ }
    recovery.addEventListener('click', async () => {
      if (state.busy || !available || !state.token) return;
      state.busy = true; sync(state);
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(endpoint(), { method: 'POST', credentials: 'omit', cache: 'no-store', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': state.recoveryReference },
          body: JSON.stringify({ statusOnly: true, turnstileToken: state.token }) });
        const result = await response.json();
        if (result.reference !== state.recoveryReference) throw new Error('Receipt could not be confirmed.');
        if (response.status === 404 && result.status === 'not_found') {
          state.status.textContent = 'No saved inquiry is visible yet. An earlier request may still be processing. Check again later before starting a separate inquiry.';
        } else if (response.ok && result.recorded === true && ['pending', 'delivered'].includes(result.status)) {
          state.status.textContent = 'Your inquiry is saved. ' + (result.emailAccepted ? 'The notification email was accepted by the provider; inbox delivery is unverified. ' : 'Email notification is not yet confirmed. ') + receiptLabel(result) + '. Do not resubmit this inquiry.';
        } else throw new Error(result.message || 'Receipt could not be confirmed.');
        state.error.textContent = '';
      } catch { state.error.textContent = 'Receipt could not be confirmed. Check again later rather than sending a duplicate inquiry.'; }
      finally {
        clearTimeout(timeout); state.busy = false; state.token = '';
        if (state.widget !== undefined) window.turnstile.reset(state.widget);
        sync(state);
      }
    });
    form.addEventListener('click', event => {
      if (event.target !== state.checkbox || state.busy) return;
      // Checkboxes toggle before click listeners run. Use confirmed state, not that provisional DOM value.
      if (state.consent && state.consentVersion === VERSION) withdrawConsent(state);
      else { event.preventDefault(); sync(state); openPrivacy(state, state.checkbox); }
    });
    form.addEventListener('keydown', event => {
      if (event.target === state.checkbox && event.key === 'Enter') { event.preventDefault(); state.checkbox.click(); }
    });
    if (!available) state.status.textContent = 'Online sending is not enabled. No inquiry data will be sent. For general contact, use plukattyleo.mejorada@gmail.com.';
    const changed = event => {
      if (event.target.name === 'contactMethod') syncContact(state);
      if (event.target.name === 'planningInterests') state.interestsTouched = true;
      state.error.textContent = ''; if (available) state.status.textContent = ''; sync(state);
    };
    form.addEventListener('input', changed); form.addEventListener('change', changed);
    form.addEventListener('focusin', () => sync(state));
    form.addEventListener('reset', () => queueMicrotask(() => {
      state.consent = false; state.consentVersion = ''; state.noticeOpened = false; state.withdrawn = false; state.interestsTouched = false;
      if (state.kind === 'financial') window.updateFollowupFields();
      syncContact(state); sync(state);
    }));
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (state.busy) return;
      state.error.textContent = ''; state.interestsTouched = true; sync(state);
      if (!form.reportValidity()) return;
      if (!state.noticeOpened || !state.consent || state.consentVersion !== VERSION) { state.error.textContent = 'Open the Privacy Notice and choose Agree & Continue before sending.'; return; }
      if (!available || !state.token) { state.error.textContent = 'Online sending is disabled or bot verification is incomplete. Nothing has been sent.'; return; }
      if (state.recoveryReference && !state.requestId) { state.error.textContent = 'Check your previous inquiry receipt before sending another inquiry.'; return; }
      const payload = payloadFor(state), serialized = JSON.stringify(payload);
      if (serialized !== state.previousPayload) { state.requestId = crypto.randomUUID(); state.previousPayload = serialized; }
      remember(state, state.requestId);
      state.busy = true; sync(state); state.status.textContent = 'Sending your inquiry…';
      const locked = [...form.elements].filter(input => input !== state.button && !input.disabled);
      locked.forEach(input => { input.disabled = true; });
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(endpoint(), {
          method: 'POST', credentials: 'omit', cache: 'no-store', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': state.requestId },
          body: JSON.stringify({ ...payload, turnstileToken: state.token })
        });
        const result = await response.json();
        if (response.ok && result.status === 'delivered' && result.recorded === true && result.emailAccepted === true && result.reference === state.requestId) {
          form.reset(); state.requestId = undefined; state.previousPayload = undefined;
          remember(state, '');
          state.status.textContent = 'Your inquiry was recorded and the notification email was accepted by the delivery service. ' + receiptLabel(result) + '. Any appointment requires separate confirmation.';
        } else if (response.status === 202 && result.status === 'pending' && result.recorded === true && result.reference === state.requestId) {
          state.status.textContent = 'Your inquiry is saved, but delivery is not yet confirmed. ' + (result.emailAccepted === true ? 'The notification email was accepted by the provider; final tracking is pending. ' : 'Email notification is not yet confirmed. ') + 'Your entries and choices are retained. Use Check previous inquiry receipt, or retry the same details later. ' + receiptLabel(result);
        } else throw new Error(result.message || 'Delivery was not confirmed. Your entries are retained; please retry later.');
      } catch (e) {
        state.status.textContent = '';
        state.error.textContent = e.name === 'AbortError' || e instanceof TypeError
          ? 'Receipt could not be confirmed. Your entries are retained. Retry without changing them to avoid duplicates, or contact Atty. Leo.' : e.message;
      } finally {
        clearTimeout(timeout); locked.forEach(input => { input.disabled = false; });
        state.busy = false; state.token = '';
        if (state.widget !== undefined) window.turnstile.reset(state.widget);
        sync(state);
      }
    });
    sync(state);
  }
})();
