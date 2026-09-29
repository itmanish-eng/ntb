(() => {
  const categoryNames = {
    1: 'Destination',
    2: 'Airline',
    4: 'Blog',
    6: 'Low Fare Calendar',
    7: 'Cancellation Flight',
    8: 'Change Flight',
    9: 'Destinations Route'
  };

  function appendInlineContent(parent, text) {
    const tokenPattern = /(!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|`([^`]+)`)/g;
    let lastIndex = 0;
    let match;

    while ((match = tokenPattern.exec(text))) {
      parent.append(document.createTextNode(text.slice(lastIndex, match.index)));

      if (match[1].startsWith('![')) {
        const imageUrl = safeUrl(match[3]);
        if (imageUrl) {
          const image = document.createElement('img');
          image.src = imageUrl;
          image.alt = match[2];
          image.loading = 'lazy';
          image.className = 'img-fluid rounded my-3';
          parent.append(image);
        } else {
          parent.append(document.createTextNode(match[0]));
        }
      } else if (match[4]) {
        const linkUrl = safeUrl(match[5]);
        if (linkUrl) {
          const link = document.createElement('a');
          link.href = linkUrl;
          link.textContent = match[4];
          if (new URL(linkUrl, window.location.href).origin !== window.location.origin) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          }
          parent.append(link);
        } else {
          parent.append(document.createTextNode(match[0]));
        }
      } else if (match[6] || match[7]) {
        const strong = document.createElement('strong');
        strong.textContent = match[6] || match[7];
        parent.append(strong);
      } else if (match[8] || match[9]) {
        const emphasis = document.createElement('em');
        emphasis.textContent = match[8] || match[9];
        parent.append(emphasis);
      } else if (match[10]) {
        const code = document.createElement('code');
        code.textContent = match[10];
        parent.append(code);
      }

      lastIndex = tokenPattern.lastIndex;
    }

    parent.append(document.createTextNode(text.slice(lastIndex)));
  }

  function safeUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function isBlockStart(lines, index) {
    const line = lines[index];
    return /^#{1,6}\s/.test(line)
      || /^\s*[-*+]\s+/.test(line)
      || /^\s*\d+[.)]\s+/.test(line)
      || /^\s*>\s?/.test(line)
      || /^\s*([-*_]\s*){3,}$/.test(line)
      || (line.includes('|') && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1]));
  }

  function renderMarkdown(markdown, container) {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    let index = 0;

    while (index < lines.length) {
      const line = lines[index].trim();
      if (!line) {
        index += 1;
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const element = document.createElement(`h${Math.min(6, heading[1].length + 1)}`);
        appendInlineContent(element, heading[2]);
        container.append(element);
        index += 1;
        continue;
      }

      if (/^([-*_]\s*){3,}$/.test(line)) {
        container.append(document.createElement('hr'));
        index += 1;
        continue;
      }

      if (line.includes('|') && index + 1 < lines.length
        && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1])) {
        const table = document.createElement('table');
        table.className = 'table table-bordered ntb-article-table';
        const headerRow = document.createElement('tr');
        const headerCells = line.split('|').slice(1, -1);
        headerCells.forEach(cellText => {
          const cell = document.createElement('th');
          appendInlineContent(cell, cellText.trim());
          headerRow.append(cell);
        });
        const head = document.createElement('thead');
        head.append(headerRow);
        table.append(head);
        index += 2;

        const body = document.createElement('tbody');
        while (index < lines.length && lines[index].includes('|')) {
          const row = document.createElement('tr');
          lines[index].split('|').slice(1, -1).forEach(cellText => {
            const cell = document.createElement('td');
            appendInlineContent(cell, cellText.trim());
            row.append(cell);
          });
          body.append(row);
          index += 1;
        }
        table.append(body);
        container.append(table);
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quote = document.createElement('blockquote');
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          const paragraph = document.createElement('p');
          appendInlineContent(paragraph, lines[index].replace(/^\s*>\s?/, '').trim());
          quote.append(paragraph);
          index += 1;
        }
        container.append(quote);
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const list = document.createElement(ordered ? 'ol' : 'ul');
        const itemPattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
        while (index < lines.length && itemPattern.test(lines[index])) {
          const item = document.createElement('li');
          appendInlineContent(item, lines[index].replace(itemPattern, '').trim());
          list.append(item);
          index += 1;
        }
        container.append(list);
        continue;
      }

      const paragraph = document.createElement('p');
      const paragraphLines = [line];
      index += 1;
      while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
        paragraphLines.push(lines[index].trim());
        index += 1;
      }
      appendInlineContent(paragraph, paragraphLines.join(' '));
      container.append(paragraph);
    }
  }

  function setError(message) {
    const title = document.getElementById('article-title');
    const content = document.getElementById('article-content');
    title.textContent = 'Article unavailable';
    content.replaceChildren();
    const error = document.createElement('p');
    error.className = 'ntb-body text-danger';
    error.textContent = message;
    content.append(error);
  }

  function renderRelatedArticles(posts, currentPost, categoryId) {
    const relatedSection = document.getElementById('related-articles');
    const relatedList = document.getElementById('related-articles-list');
    const sameCategory = posts.filter(item =>
      Number(item.id) !== Number(currentPost.id) && Number(item.category) === categoryId
    );
    const otherArticles = posts.filter(item =>
      Number(item.id) !== Number(currentPost.id) && Number(item.category) !== categoryId
    );
    const relatedPosts = [...sameCategory, ...otherArticles].slice(0, 3);

    if (!relatedPosts.length) return;

    relatedList.replaceChildren(...relatedPosts.map(post => {
      const link = document.createElement('a');
      link.className = 'ntb-related-article-card';
      link.href = `article-details.html?id=${encodeURIComponent(post.id)}`;
      link.setAttribute('aria-label', `Read related article: ${post.title}`);

      const category = document.createElement('span');
      category.className = 'ntb-related-article-category';
      category.textContent = categoryNames[Number(post.category)] || 'Travel guide';

      const title = document.createElement('h3');
      title.textContent = post.title;

      const excerpt = document.createElement('p');
      excerpt.textContent = typeof post.meta_description === 'string'
        ? post.meta_description.trim()
        : '';

      const arrow = document.createElement('span');
      arrow.className = 'ntb-related-article-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      const arrowIcon = document.createElement('i');
      arrowIcon.className = 'bi bi-arrow-up-right';
      arrow.append(arrowIcon);

      link.append(category, title, excerpt, arrow);
      return link;
    }));
    relatedSection.hidden = false;
  }

  async function loadArticle() {
    const idValue = new URLSearchParams(window.location.search).get('id');
    const articleId = Number(idValue);
    if (!idValue || !Number.isInteger(articleId) || articleId < 1) {
      setError('Select an article to read.');
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

      const post = posts.find(item => Number(item.id) === articleId);
      if (!post) {
        setError('The requested article could not be found.');
        return;
      }

      const categoryId = Number(post.category);
      renderRelatedArticles(posts, post, categoryId);
      const categoryName = categoryNames[categoryId] || `Category ${categoryId}`;
      const title = typeof post.banner_title === 'string' && post.banner_title.trim()
        ? post.banner_title.trim()
        : post.title;
      const summary = typeof post.meta_description === 'string' ? post.meta_description.trim() : '';
      document.title = `${post.seo_title || post.title} — Nowtobook`;
      document.querySelector('meta[name="description"]').content = summary;
      document.getElementById('article-title').textContent = title;
      document.getElementById('article-summary').textContent = summary;
      document.getElementById('article-category').textContent = categoryName;
      document.getElementById('article-category-link').textContent = `${categoryName} articles`;
      document.getElementById('article-category-link').href = `articles.html?id=${categoryId}`;
      document.getElementById('article-breadcrumb').textContent = post.title;

      const imagePath = typeof post.banner_image_option === 'string' && post.banner_image_option.trim()
        ? post.banner_image_option
        : post.ThumbImage;
      const heroImage = document.getElementById('article-hero-image');
      if (typeof imagePath === 'string' && imagePath.trim()) {
        heroImage.src = `assets/images/${imagePath.replace(/^\/+/, '')}`;
        heroImage.alt = typeof post.banner_alt_tag === 'string' ? post.banner_alt_tag : '';
        heroImage.addEventListener('error', () => {
          if (heroImage.dataset.fallbackApplied === 'true') {
            heroImage.hidden = true;
            return;
          }
          heroImage.dataset.fallbackApplied = 'true';
          heroImage.src = 'assest/destination/goa.jpg';
        });
      } else {
        heroImage.hidden = true;
      }

      const content = document.getElementById('article-content');
      content.replaceChildren();
      if (typeof post.content === 'string' && post.content.trim()) {
        renderMarkdown(post.content, content);
      } else {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'ntb-body ntb-muted';
        emptyMessage.textContent = summary || 'Article content is not available yet.';
        content.append(emptyMessage);
      }

      if (categoryId !== 4) {
        document.body.classList.add('ntb-article-has-search');
        const searchContainer = document.createElement('div');
        searchContainer.id = 'article-flight-search';
        document.getElementById('article-search').append(searchContainer);
        await window.ComponentLoader.load('search-form', searchContainer);
        if (!window.FlightSearchForm) {
          throw new Error('Flight search form is not available.');
        }
        await window.FlightSearchForm.init(searchContainer);
      } else {
        document.body.classList.add('ntb-article-blog');
      }
    } catch (error) {
      console.error('Unable to display article details.', error);
      setError('This article could not be loaded. Please try again later.');
    }
  }

  loadArticle();
})();
