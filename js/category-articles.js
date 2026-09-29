(() => {
  const pageSize = 8;
  const maxVisiblePages = 5;
  const categoryNames = {
    1: 'Destination',
    2: 'Airline',
    4: 'Blog',
    6: 'Low Fare Calendar',
    7: 'Cancellation Flight',
    8: 'Change Flight',
    9: 'Destinations Route'
  };
  const fallbackImages = [
    'assest/destination/goa.jpg',
    'assest/destination/dubai.jpeg',
    'assest/destination/bangkok.jpg',
    'assest/destination/Singapore.webp',
    'assest/destination/London.webp',
    'assest/destination/Maldives.jpg',
    'assest/destination/New York.jpg'
  ];

  function showError(message) {
    const container = document.getElementById('category-articles');
    const count = document.getElementById('articles-count');
    if (count) count.textContent = '';
    if (!container) return;

    const error = document.createElement('p');
    error.className = 'col-12 ntb-body text-danger';
    error.textContent = message;
    container.replaceChildren(error);
  }

  function createArticleCard(post) {
    const column = document.createElement('div');
    column.className = 'col-md-6 col-lg-3';

    const card = document.createElement('article');
    card.className = 'ntb-feature-card ntb-article-card h-100';

    const cardLink = document.createElement('a');
    cardLink.className = 'ntb-article-card-link';
    cardLink.href = `article-details.html?id=${encodeURIComponent(post.id)}`;
    cardLink.setAttribute('aria-label', `Read article: ${post.title}`);

    if (typeof post.ThumbImage === 'string' && post.ThumbImage.trim()) {
      const imageFrame = document.createElement('div');
      imageFrame.className = 'ratio ratio-16x9 ntb-article-image';
      const image = document.createElement('img');
      image.className = 'w-100 h-100 object-fit-cover';
      image.src = `assets/images/${post.ThumbImage.replace(/^\/+/, '')}`;
      image.alt = typeof post.banner_alt_tag === 'string' && post.banner_alt_tag.trim()
        ? post.banner_alt_tag
        : post.title;
      image.loading = 'lazy';
      image.addEventListener('error', () => {
        if (image.dataset.fallbackApplied === 'true') {
          imageFrame.remove();
          return;
        }

        const postId = Number(post.id) || 0;
        image.dataset.fallbackApplied = 'true';
        image.src = fallbackImages[postId % fallbackImages.length];
      }, { once: true });
      imageFrame.append(image);
      cardLink.append(imageFrame);
    }

    const content = document.createElement('div');
    content.className = 'ntb-article-content';

    const title = document.createElement('h3');
    title.className = 'ntb-h4 ntb-article-title';
    title.textContent = post.title;
    content.append(title);

    if (typeof post.meta_description === 'string' && post.meta_description.trim()) {
      const description = document.createElement('p');
      description.className = 'ntb-body ntb-muted ntb-article-description mb-0';
      description.textContent = post.meta_description;
      content.append(description);
    }

    const readMore = document.createElement('span');
    readMore.className = 'ntb-link-more d-inline-block mt-3';
    readMore.append(document.createTextNode('Read more '));
    const arrow = document.createElement('i');
    arrow.className = 'bi bi-arrow-right ms-1';
    arrow.setAttribute('aria-hidden', 'true');
    readMore.append(arrow);
    content.append(readMore);
    cardLink.append(content);
    card.append(cardLink);

    column.append(card);
    return column;
  }

  function createPageButton(label, page, options = {}) {
    const item = document.createElement('li');
    item.className = `page-item${options.active ? ' active' : ''}${options.disabled ? ' disabled' : ''}`;

    const button = document.createElement('button');
    button.className = 'page-link';
    button.type = 'button';
    button.textContent = label;
    button.disabled = Boolean(options.disabled);
    if (options.active) {
      button.setAttribute('aria-current', 'page');
      button.setAttribute('aria-label', `Page ${page}, current page`);
    } else if (!options.disabled && options.onClick) {
      button.setAttribute('aria-label', `Go to page ${page}`);
      button.addEventListener('click', options.onClick);
    }

    item.append(button);
    return item;
  }

  function renderPagination(totalItems, currentPage, onPageChange) {
    const nav = document.getElementById('article-pagination-nav');
    const list = document.getElementById('article-pagination');
    const totalPages = Math.ceil(totalItems / pageSize);
    list.replaceChildren();
    nav.hidden = totalPages <= 1;
    if (totalPages <= 1) return;

    list.append(
      createPageButton('«', 1, {
        disabled: currentPage === 1,
        onClick: () => onPageChange(1)
      }),
      createPageButton('‹', currentPage - 1, {
        disabled: currentPage === 1,
        onClick: () => onPageChange(currentPage - 1)
      })
    );

    const halfWindow = Math.floor(maxVisiblePages / 2);
    const firstPage = Math.max(1, Math.min(currentPage - halfWindow, totalPages - maxVisiblePages + 1));
    const lastPage = Math.min(totalPages, firstPage + maxVisiblePages - 1);

    for (let page = firstPage; page <= lastPage; page += 1) {
      const pageButton = createPageButton(String(page), page, {
        active: page === currentPage,
        onClick: () => onPageChange(page)
      });
      list.append(pageButton);
    }

    list.append(
      createPageButton('›', currentPage + 1, {
        disabled: currentPage === totalPages,
        onClick: () => onPageChange(currentPage + 1)
      }),
      createPageButton('»', totalPages, {
        disabled: currentPage === totalPages,
        onClick: () => onPageChange(totalPages)
      })
    );
  }

  async function loadArticles() {
    const idValue = new URLSearchParams(window.location.search).get('id');
    const categoryId = Number(idValue);
    if (!idValue || !Number.isInteger(categoryId) || categoryId < 1) {
      showError('Select a category to view its articles.');
      return;
    }

    try {
      const response = await fetch('data/blog-contant.json');
      if (!response.ok) {
        throw new Error(`Could not load articles: HTTP ${response.status}`);
      }

      const payload = await response.json();
      const posts = Object.values(payload).find(Array.isArray);
      if (!posts) {
        throw new Error('Blog data does not contain a posts array.');
      }

      const categoryPosts = posts.filter(post => Number(post.category) === categoryId);
      if (categoryPosts.length === 0) {
        showError(`No articles were found for category ${categoryId}.`);
        return;
      }

      const categoryName = categoryNames[categoryId] || `Category ${categoryId}`;
      document.title = `${categoryName} Articles — Nowtobook`;
      document.getElementById('articles-heading').textContent = categoryName;
      document.getElementById('articles-title').textContent = `${categoryName} articles`;
      document.getElementById('articles-count').textContent = `${categoryPosts.length} articles`;
      document.getElementById('category-breadcrumb').textContent = categoryName;

      const container = document.getElementById('category-articles');
      const requestedPage = Number(new URLSearchParams(window.location.search).get('page')) || 1;
      const totalPages = Math.ceil(categoryPosts.length / pageSize);
      let currentPage = Math.max(1, Math.min(requestedPage, totalPages));

      const renderPageWithUrl = page => {
        const url = new URL(window.location.href);
        url.searchParams.set('page', String(page));
        window.history.pushState({}, '', url);
        renderPage(page);
      };

      const renderPage = page => {
        currentPage = page;
        const startIndex = (currentPage - 1) * pageSize;
        const visiblePosts = categoryPosts.slice(startIndex, startIndex + pageSize);
        container.replaceChildren(...visiblePosts.map(createArticleCard));
        document.getElementById('articles-count').textContent =
          `Showing ${startIndex + 1}–${startIndex + visiblePosts.length} of ${categoryPosts.length} articles`;
        renderPagination(categoryPosts.length, currentPage, renderPageWithUrl);
      };

      window.addEventListener('popstate', () => {
        const pageFromUrl = Number(new URLSearchParams(window.location.search).get('page')) || 1;
        renderPage(Math.max(1, Math.min(pageFromUrl, totalPages)));
      });

      renderPage(currentPage);
    } catch (error) {
      console.error('Unable to display category articles.', error);
      showError('Articles could not be loaded. Please try again later.');
    }
  }

  loadArticles();
})();
