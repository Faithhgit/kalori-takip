export function escapeAttribute(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

export function renderSelectOptions(options, selectedValue = '') {
    return (options || []).map(option => {
        const value = escapeAttribute(option.value);
        const selected = String(option.value) === String(selectedValue) ? ' selected' : '';
        return `<option value="${value}"${selected}>${escapeAttribute(option.label)}</option>`;
    }).join('');
}

export function setModalOpen(modal, open, focusTarget = null) {
    if (!modal) return;
    modal.classList.toggle('active', Boolean(open));
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open && focusTarget) {
        window.requestAnimationFrame(() => focusTarget.focus());
    }
}

export function renderMetricCard({ label, value, note = '', className = '' }) {
    return `
        <article class="metric-card ${escapeAttribute(className)}">
            <span>${escapeAttribute(label)}</span>
            <strong>${escapeAttribute(value)}</strong>
            ${note ? `<small>${escapeAttribute(note)}</small>` : ''}
        </article>
    `;
}
