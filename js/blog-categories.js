(() => {
  const categoryDetails = {
    1: { name: 'Destination', icon: 'bi-geo-alt' },
    2: { name: 'Airline', icon: 'bi-airplane' },
    4: { name: 'Blog', icon: 'bi-journal-text' },
    6: { name: 'Low Fare Calendar', icon: 'bi-calendar3' },
    7: { name: 'Cancellation Flight', icon: 'bi-x-circle' },
    8: { name: 'Change Flight', icon: 'bi-arrow-left-right' },
    9: { name: 'Destinations Route', icon: 'bi-signpost-split' }
  };

  function createCategoryCard(categoryId, posts) {
    const details = categoryDetails[categoryId] || {
      name: `Category ${categoryId}`,
      icon: 'bi-journal-text'
    };
    const column = document.createElement('div');
    column.className = 'col-md-6 col-lg-3';

    const link = document.createElement('a');
    link.className = 'd-block h-100 text-decoration-none';
    link.href = `articles.html?id=${categoryId}`;
    link.setAttribute('aria-label', `Browse ${posts.length} ${details.name} articles`);

    const card = document.createElement('article');
    card.className = 'ntb-feature-card h-100';

    const icon = document.createElement('div');
    icon.className = 'ntb-feature-icon';
    const iconElement = document.createElement('i');
    iconElement.className = `bi ${details.icon}`;
    iconElement.setAttribute('aria-hidden', 'true');
    icon.append(iconElement);
    card.append(icon);

    const headingRow = document.createElement('div');
    headingRow.className = 'd-flex justify-content-between align-items-center gap-3';
    const heading = document.createElement('h3');
    heading.className = 'ntb-h4 mb-0';
    heading.textContent = details.name;
    const count = document.createElement('span');
    count.className = 'ntb-body ntb-muted';
    count.textContent = String(posts.length);
    headingRow.append(heading, count);
    card.append(headingRow);

    const explore = document.createElement('span');
    explore.className = 'ntb-link-more d-inline-block mt-3';
    explore.append(document.createTextNode('Explore '));
    const arrow = document.createElement('i');
    arrow.className = 'bi bi-arrow-right ms-1';
    arrow.setAttribute('aria-hidden', 'true');
    explore.append(arrow);
    card.append(explore);

    link.append(card);
    column.append(link);
    return column;
  }

  async function loadCategories() {
    const container = document.getElementById('blog-categories');
    if (!container) return;

    try {
      const response = await fetch('data/blog-contant.json');
      if (!response.ok) {
        throw new Error(`Could not load blog categories: HTTP ${response.status}`);
      }

      const payload = await response.json();
      const posts = Object.values(payload).find(Array.isArray);
      if (!posts) {
        throw new Error('Blog data does not contain a posts array.');
      }

      const categories = new Map();
      posts.forEach(post => {
        const categoryId = Number(post.category);
        if (!Number.isInteger(categoryId) || categoryId < 1 || typeof post.title !== 'string') {
          throw new Error('Blog data contains a post with an invalid category or title.');
        }

        if (!categories.has(categoryId)) categories.set(categoryId, []);
        categories.get(categoryId).push(post);
      });

      if (categories.size === 0) {
        throw new Error('Blog data contains no categorized posts.');
      }

      const cards = [...categories.entries()]
        .sort(([categoryA], [categoryB]) => categoryA - categoryB)
        .map(([categoryId, categoryPosts]) => createCategoryCard(categoryId, categoryPosts));
      container.replaceChildren(...cards);
    } catch (error) {
      console.error('Unable to display blog categories.', error);
      const message = document.createElement('p');
      message.className = 'col-12 ntb-body text-danger';
      message.textContent = 'Categories could not be loaded. Please try again later.';
      container.replaceChildren(message);
    }
  }

  loadCategories();
})();
