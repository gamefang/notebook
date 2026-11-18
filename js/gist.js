// Generic GitHub Gist service shared by all note files.
import { config } from './config.js';

const GITHUB_API = config.gist.apiBase;

export class GistServiceError extends Error {
  constructor(message, status = 0, details = '') {
    super(message);
    this.name = 'GistServiceError';
    this.status = status;
    this.details = details;
  }
}

async function request(url, options = {}) {
  let response;

  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers
      }
    });
  } catch (error) {
    throw new GistServiceError(
      'Network request failed. Check your connection and try again.',
      0,
      error?.message ?? ''
    );
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.message || `${response.status} ${response.statusText}`;
    throw new GistServiceError(message, response.status);
  }

  return data;
}

function createAuthHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const GistService = Object.freeze({
  // Lists every Gist owned by the authenticated user, including Secret Gists.
  // GitHub returns up to 100 Gists per page.
  async listGists(token) {
    if (!token) throw new GistServiceError('errorTokenRequired');

    const gists = [];
    let page = 1;

    while (true) {
      const batch = await request(
        `${GITHUB_API}/gists?per_page=100&page=${page}`,
        { headers: createAuthHeaders(token) }
      );

      if (!Array.isArray(batch)) {
        throw new GistServiceError('GitHub returned an invalid Gist list.');
      }

      gists.push(...batch.map((gist) => ({
        id: gist.id,
        description: gist.description ?? '',
        htmlUrl: gist.html_url ?? `https://gist.github.com/${gist.id}`,
        public: Boolean(gist.public),
        updatedAt: gist.updated_at ?? null,
        files: Object.entries(gist.files ?? {}).map(([filename, file]) => ({
          filename,
          size: Number(file.size ?? 0),
          language: file.language ?? ''
        }))
      })));

      if (batch.length < 100) break;
      page += 1;
    }

    return gists;
  },

  async readGist(gistId, token = '') {
    if (!gistId) throw new GistServiceError('errorGistIdRequired');

    const gist = await request(
      `${GITHUB_API}/gists/${encodeURIComponent(gistId)}`,
      { headers: createAuthHeaders(token) }
    );

    if (gist?.truncated) {
      throw new GistServiceError(
        'GitHub returned an incomplete Gist file list (more than 300 files).'
      );
    }

    const files = Object.entries(gist?.files ?? {}).map(([filename, file]) => ({
      filename,
      content: typeof file.content === 'string' ? file.content : null,
      truncated: Boolean(file.truncated),
      rawUrl: file.raw_url ?? '',
      size: Number(file.size ?? 0),
      language: file.language ?? ''
    }));

    return {
      id: gist.id,
      description: gist.description ?? '',
      htmlUrl: gist.html_url ?? `https://gist.github.com/${gist.id}`,
      public: Boolean(gist.public),
      updatedAt: gist.updated_at ?? null,
      files
    };
  },

  // Creates a Gist containing one or more files.
  // `public: false` creates a Secret Gist (unlisted, not private).
  //
  // Example:
  // GistService.createGist(token, {
  //   description: 'My notes',
  //   public: false,
  //   files: { 'notes.md': 'Hello world' }
  // });
  async createGist(token, {
    description = '',
    public: isPublic = false,
    files
  } = {}) {
    if (!token) throw new GistServiceError('errorTokenRequired');

    if (!files || typeof files !== 'object' || Array.isArray(files) || !Object.keys(files).length) {
      throw new GistServiceError('At least one Gist file is required.');
    }

    const gistFiles = Object.fromEntries(
      Object.entries(files).map(([filename, content]) => {
        if (!filename || typeof content !== 'string') {
          throw new GistServiceError('Invalid Gist file.');
        }

        return [filename, { content }];
      })
    );

    return request(`${GITHUB_API}/gists`, {
      method: 'POST',
      headers: {
        ...createAuthHeaders(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: String(description ?? ''),
        public: Boolean(isPublic),
        files: gistFiles
      })
    });
  },

  // Updates multiple files in one Gist with a single PATCH request.
  async writeFiles(gistId, token, files) {
    if (!token) throw new GistServiceError('errorTokenRequired');
    if (!gistId) throw new GistServiceError('errorGistIdRequired');

    return request(
      `${GITHUB_API}/gists/${encodeURIComponent(gistId)}`,
      {
        method: 'PATCH',
        headers: {
          ...createAuthHeaders(token),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          files: Object.fromEntries(
            Object.entries(files).map(([filename, content]) => [
              filename,
              { content }
            ])
          )
        })
      }
    );
  }
});