const PAGE_META = {
    dashboard: {
        title: 'Özet'
    },
    logs: {
        title: 'Günlük'
    },
    add: {
        title: 'Besin ekle'
    },
    progress: {
        title: 'İlerleme'
    },
    catalog: {
        title: 'Besinler'
    },
    health: {
        title: 'Sağlık'
    }
};

const DEFAULT_PAGE = 'dashboard';
const CATALOG_VIEWS = new Set(['foods', 'templates']);

function setCatalogView(viewName) {
    const nextView = CATALOG_VIEWS.has(viewName) ? viewName : 'foods';
    document.body.dataset.catalogView = nextView;

    document.querySelectorAll('[data-catalog-view]').forEach(button => {
        const isActive = button.dataset.catalogView === nextView;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', String(isActive));
    });

    if (nextView === 'foods' && typeof window.renderCatalog === 'function') {
        window.renderCatalog();
    }
    if (nextView === 'templates' && typeof window.renderTemplateList === 'function') {
        window.renderTemplateList();
    }
}

function getPageFromLocation() {
    const pageName = window.location.hash.replace(/^#\/?/, '');
    if (pageName === 'templates') {
        setCatalogView('templates');
        return 'catalog';
    }
    return PAGE_META[pageName] ? pageName : DEFAULT_PAGE;
}

function renderPage(pageName, options = {}) {
    const { scroll = true } = options;
    const nextPage = PAGE_META[pageName] ? pageName : DEFAULT_PAGE;
    document.body.dataset.page = nextPage;

    document.querySelectorAll('.tab-button').forEach(button => {
        const isActive = button.dataset.tab === nextPage;
        button.classList.toggle('active', isActive);
        if (isActive) {
            button.setAttribute('aria-current', 'page');
        } else {
            button.removeAttribute('aria-current');
        }
    });

    document.querySelectorAll('.main-content [data-page]').forEach(pagePart => {
        const isActive = pagePart.dataset.page === nextPage;
        pagePart.classList.toggle('page-active', isActive);
        pagePart.classList.toggle('active', isActive && pagePart.classList.contains('tab-content'));
        pagePart.hidden = !isActive;
    });

    const meta = PAGE_META[nextPage];
    document.getElementById('pageTitle').textContent = meta.title;
    document.title = `${meta.title} — Denge`;

    if (nextPage === 'catalog') {
        if (typeof window.renderCatalog === 'function') window.renderCatalog();
        if (typeof window.renderTemplateList === 'function') window.renderTemplateList();
    }

    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchTab(pageName) {
    const nextPage = PAGE_META[pageName] ? pageName : DEFAULT_PAGE;
    const nextHash = `#/${nextPage}`;
    if (window.location.hash !== nextHash) {
        window.history.pushState({ page: nextPage }, '', nextHash);
    }
    renderPage(nextPage);
}

window.switchTab = switchTab;
window.setCatalogView = setCatalogView;
document.querySelectorAll('[data-catalog-view]').forEach(button => {
    button.addEventListener('click', () => setCatalogView(button.dataset.catalogView));
});
setCatalogView(document.body.dataset.catalogView || 'foods');
window.addEventListener('hashchange', () => renderPage(getPageFromLocation()));
renderPage(getPageFromLocation(), { scroll: false });
