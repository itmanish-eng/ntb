(() => {
  const categoryDetails = {
    1: { name: 'Destinations', icon: 'bi-geo-alt' },
    2: { name: 'Airlines', icon: 'bi-airplane' },
    4: { name: 'Blog', icon: 'bi-journal-text' },
    6: { name: 'Low Fare Calendar', icon: 'bi-calendar3' },
    7: { name: 'Cancellation Flight', icon: 'bi-x-circle' },
    8: { name: 'Change Flight', icon: 'bi-arrow-left-right' },
    9: { name: 'Destinations Route', icon: 'bi-signpost-split' }
  };

  function createCategoryGroup(categoryId, posts) {
    const details = categoryDetails[categoryId] || {
      name: `Category ${categoryId}`,
      icon: 'bi-journal-text'
    };
    const section = document.createElement('section');
    section.className = 'ntb-sitemap-group';
    section.setAttribute('aria-labelledby', `sitemap-category-${categoryId}`);

    const heading = document.createElement('div');
    heading.className = 'ntb-sitemap-group-heading';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'ntb-sitemap-group-title';
    const icon = document.createElement('span');
    icon.className = 'ntb-sitemap-group-icon';
    icon.setAttribute('aria-hidden', 'true');
    const iconElement = document.createElement('i');
    iconElement.className = `bi ${details.icon}`;
    icon.append(iconElement);

    const title = document.createElement('h2');
    title.className = 'ntb-h4 mb-0';
    title.id = `sitemap-category-${categoryId}`;
    title.textContent = details.name;
    titleWrap.append(icon, title);

    const count = document.createElement('span');
    count.className = 'ntb-sitemap-count';
    count.textContent = `${posts.length} ${posts.length === 1 ? 'article' : 'articles'}`;
    heading.append(titleWrap, count);

    const list = document.createElement('ul');
    list.className = 'ntb-sitemap-links';
    posts.forEach(post => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `article-details.html?id=${encodeURIComponent(post.id)}`;
      link.setAttribute('aria-label', `Read article: ${post.title}`);
      const arrow = document.createElement('i');
      arrow.className = 'bi bi-arrow-up-right';
      arrow.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = post.title;
      link.append(arrow, text);
      item.append(link);
      list.append(item);
    });

    section.append(heading, list);
    return section;
  }

  async function loadSitemap() {
    const container = document.getElementById('sitemap-groups');
    if (!container) return;

    try {
      const response = await fetch('data/blog-contant.json');
      if (!response.ok) {
        throw new Error(`Could not load sitemap content: HTTP ${response.status}`);
      }

      const payload = await response.json();
      const posts = Object.values(payload).find(Array.isArray);
      if (!posts) {
        throw new Error('Blog data does not contain a posts array.');
      }

      const categories = new Map();
      posts.forEach(post => {
        const categoryId = Number(post.category);
        if (!Number.isInteger(categoryId) || categoryId < 1
          || post.id === undefined || typeof post.title !== 'string' || !post.title.trim()) {
          throw new Error('Blog data contains an article with an invalid category, ID, or title.');
        }

        if (!categories.has(categoryId)) categories.set(categoryId, []);
        categories.get(categoryId).push(post);
      });

      if (categories.size === 0) {
        throw new Error('Blog data contains no categorized articles.');
      }

      const groups = [...categories.entries()]
        .sort(([categoryA], [categoryB]) => categoryA - categoryB)
        .map(([categoryId, categoryPosts]) => createCategoryGroup(categoryId, categoryPosts));
      container.replaceChildren(...groups);
    } catch (error) {
      console.error('Unable to display sitemap.', error);
      const message = document.createElement('p');
      message.className = 'ntb-body text-danger';
      message.textContent = 'The sitemap could not be loaded. Please try again later.';
      container.replaceChildren(message);
    }
  }

  loadSitemap();
})();
