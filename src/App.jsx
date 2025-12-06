import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import './App.css';

const STORAGE_KEY = "movies";
const MOVIES_JSON_URL = "https://raw.githubusercontent.com/prust/wikipedia-movie-data/master/movies.json";
const DISPLAY_LIMIT = 500; // show this many movies initially
const CHUNK_SIZE = 500;    // how many to append when "Load more" is clicked

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveToStorageAsync(movies) {
  // Use requestIdleCallback if available to avoid blocking main thread
  const doSave = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(movies));
    } catch (e) {
      console.error("Storage save failed:", e);
    }
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(doSave, { timeout: 2000 });
  } else {
    // fallback
    setTimeout(doSave, 50);
  }
}

function getUniqueGenres(movies) {
  const genres = new Set();
  movies.forEach(movie => {
    movie.genres?.forEach(genre => genres.add(genre));
  });
  return Array.from(genres).sort();
}

export default function App() {
  const [movies, setMovies] = useState([]); // this will be the currently loaded subset (initially <= DISPLAY_LIMIT)
  const restRef = useRef([]); // store the rest of the loaded dataset here (not rendered until requested)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [titleFilter, setTitleFilter] = useState("");
  const [genreFilter, setGenreFilter] = useState([]);
  const [showGenrePanel, setShowGenrePanel] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingMovie, setEditingMovie] = useState(null);
  const [formData, setFormData] = useState({
    title: "",
    year: "",
    cast: "",
    genres: [],
    thumbnail: ""
  });

  // Ref to prevent double fetch in StrictMode
  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    const fetchMovies = async () => {
      try {
        setLoading(true);
        setError("");

        // Try loading from localStorage first
        let stored = loadFromStorage();

        if (stored && Array.isArray(stored) && stored.length > 0) {
          // if storage contains many items, split into displayed + rest to avoid blocking render
          setMovies(stored.slice(0, DISPLAY_LIMIT));
          restRef.current = stored.slice(DISPLAY_LIMIT);
        } else {
          const response = await fetch(MOVIES_JSON_URL);
          if (!response.ok) throw new Error("Failed to fetch movies");
          const data = await response.json();

          // Convert and stable-id the data
          const mapped = data.map((movie, index) => ({
            id: `movie-${index}-${movie.title ? movie.title.replace(/[^a-z0-9]/gi, '-').toLowerCase() : index}`,
            title: movie.title || "",
            year: movie.year || 0,
            cast: Array.isArray(movie.cast) ? movie.cast : [],
            genres: Array.isArray(movie.genres) ? movie.genres : [],
            thumbnail: movie.thumbnail || ""
          }));

          // show only a limited chunk initially to keep UI responsive
          setMovies(mapped.slice(0, DISPLAY_LIMIT));
          restRef.current = mapped.slice(DISPLAY_LIMIT);

          // Save full dataset to storage but asynchronously (non-blocking)
          saveToStorageAsync(mapped);
        }
      } catch (err) {
        setError(err.message || "Failed to load movies");
        console.error("Fetch error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMovies();
  }, []);

  // helper to load more items into UI (non-blocking)
  const loadMore = useCallback(() => {
    if (!restRef.current || restRef.current.length === 0) return;
    const chunk = restRef.current.slice(0, CHUNK_SIZE);
    restRef.current = restRef.current.slice(CHUNK_SIZE);
    // append chunk without blocking storage write
    setMovies(prev => [...prev, ...chunk]);
  }, []);

  const allGenres = useMemo(() => getUniqueGenres([...movies, ...restRef.current]), [movies]); // compute from both loaded and rest

  const filteredMovies = useMemo(() => {
    const base = movies; // only filtering the currently loaded set; if you want to filter entire dataset, filter [...movies, ...restRef.current]
    if (!base || base.length === 0) return [];

    return base.filter(movie => {
      const matchesTitle = !titleFilter ||
        movie.title.toLowerCase().includes(titleFilter.toLowerCase());
      const matchesGenre = !genreFilter.length ||
        movie.genres.some(genre => genreFilter.includes(genre));
      return matchesTitle && matchesGenre;
    });
  }, [movies, titleFilter, genreFilter]);

  const handleCreate = useCallback(() => {
    setEditingMovie(null);
    setFormData({ title: "", year: "", cast: "", genres: [], thumbnail: "" });
    setShowModal(true);
  }, []);

  const handleEdit = useCallback((movie) => {
    setEditingMovie(movie);
    setFormData({
      title: movie.title,
      year: movie.year.toString(),
      cast: movie.cast.join(", "),
      genres: movie.genres,
      thumbnail: movie.thumbnail
    });
    setShowModal(true);
  }, []);

  const handleDelete = useCallback((id) => {
    if (!window.confirm("Delete this movie?")) return;

    // remove from currently loaded movies
    setMovies(prev => {
      const newLoaded = prev.filter(m => m.id !== id);
      // also remove from restRef if exists there
      restRef.current = restRef.current.filter(m => m.id !== id);
      // save entire dataset (loaded + rest) asynchronously
      saveToStorageAsync([...newLoaded, ...restRef.current]);
      return newLoaded;
    });
  }, []);

  const handleSave = useCallback((e) => {
    e.preventDefault();
    const cast = formData.cast
      .split(",")
      .map(name => name.trim())
      .filter(Boolean);

    const movieData = {
      id: editingMovie?.id || `movie-new-${Date.now()}-${formData.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
      title: formData.title.trim(),
      year: parseInt(formData.year) || 0,
      cast,
      genres: formData.genres,
      thumbnail: formData.thumbnail.trim()
    };

    setMovies(prev => {
      let newLoaded;
      if (editingMovie) {
        newLoaded = prev.map(m => m.id === editingMovie.id ? movieData : m);
      } else {
        newLoaded = [movieData, ...prev];
      }
      // save full combined dataset (loaded + rest) asynchronously
      saveToStorageAsync([...newLoaded, ...restRef.current]);
      return newLoaded;
    });

    setShowModal(false);
  }, [editingMovie, formData]);

  const handleCloseModal = useCallback(() => {
    setShowModal(false);
    setEditingMovie(null);
  }, []);

  const handleGenreToggle = useCallback((genre) => {
    setGenreFilter(prev => {
      if (prev.includes(genre)) {
        return prev.filter(g => g !== genre);
      } else {
        return [...prev, genre];
      }
    });
  }, []);

  const clearGenreFilters = useCallback(() => {
    setGenreFilter([]);
  }, []);

  if (loading) {
    return <div className="loading">Loading movies...</div>;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🎬 Movie Database</h1>
        <p>{movies.length + restRef.current.length} movies available • {filteredMovies.length} displayed</p>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="controls">
        <div className="filter-group">
          <label>Search by title:</label>
          <input
            type="text"
            placeholder="Filter by title..."
            value={titleFilter}
            onChange={(e) => setTitleFilter(e.target.value)}
            className="filter-input"
          />
        </div>

        <div className="filter-group">
          <label>Filter by genres:</label>
          <button
            type="button"
            className="genre-filter-button"
            onClick={() => setShowGenrePanel(!showGenrePanel)}
          >
            {genreFilter.length === 0 ? "All Genres" : `${genreFilter.length} selected`}
            <span className="filter-icon">{showGenrePanel ? "✕" : "⚙"}</span>
          </button>

          {genreFilter.length > 0 && (
            <div className="selected-genres">
              {genreFilter.map(genre => (
                <span key={genre} className="genre-chip">
                  {genre}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGenreToggle(genre);
                    }}
                    className="chip-remove"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <button onClick={handleCreate} className="add-btn">
          ➕ Add Movie
        </button>
      </div>

      {showGenrePanel && (
        <div className="genre-panel">
          <div className="genre-panel-header">
            <h3>Select Genres ({genreFilter.length} selected)</h3>
            {genreFilter.length > 0 && (
              <button onClick={clearGenreFilters} className="clear-all-btn">
                Clear All
              </button>
            )}
          </div>
          <div className="genre-grid">
            {allGenres.map(genre => (
              <label key={genre} className="genre-checkbox-label">
                <input
                  type="checkbox"
                  checked={genreFilter.includes(genre)}
                  onChange={() => handleGenreToggle(genre)}
                  className="genre-checkbox"
                />
                <span className="genre-text">{genre}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <MovieTable
        movies={filteredMovies}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      {/* Load more button if there are more items not yet appended to the UI */}
      {restRef.current.length > 0 && (
        <div style={{ textAlign: "center", margin: "1rem 0" }}>
          <button onClick={loadMore}>Load more ({restRef.current.length})</button>
        </div>
      )}

      {showModal && (
        <MovieModal
          formData={formData}
          setFormData={setFormData}
          allGenres={allGenres}
          onSave={handleSave}
          onClose={handleCloseModal}
          isEditing={!!editingMovie}
        />
      )}
    </div>
  );
}

/* MovieTable and MovieModal remain unchanged (you can paste your same components here) */
function MovieTable({ movies, onEdit, onDelete }) {
  return (
    <div className="table-container">
      <table className="movies-table">
        <thead>
          <tr>
            <th>Thumbnail</th>
            <th>Title</th>
            <th>Year</th>
            <th>Cast</th>
            <th>Genres</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {movies.length === 0 ? (
            <tr>
              <td colSpan="6" className="no-data">
                No movies found matching your criteria
              </td>
            </tr>
          ) : (
            movies.map(movie => (
              <tr key={movie.id}>
                <td className="thumbnail-cell">
                  {movie.thumbnail ? (
                    <img
                      src={movie.thumbnail}
                      alt={movie.title}
                      className="movie-thumbnail"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  ) : null}
                  {!movie.thumbnail && <span className="no-thumbnail">No Image</span>}
                </td>
                <td className="title-cell">{movie.title}</td>
                <td>{movie.year}</td>
                <td className="cast-cell" title={movie.cast.join(", ")}>
                  {movie.cast.slice(0, 2).join(", ")}
                  {movie.cast.length > 2 && "..."}
                </td>
                <td className="genres-cell" title={movie.genres.join(", ")}>
                  {movie.genres.slice(0, 3).join(", ")}
                  {movie.genres.length > 3 && "..."}
                </td>
                <td className="actions-cell">
                  <button onClick={() => onEdit(movie)} className="edit-btn">✏️ Edit</button>
                  <button onClick={() => onDelete(movie.id)} className="delete-btn">🗑️ Delete</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function MovieModal({ formData, setFormData, allGenres, onSave, onClose, isEditing }) {
  const handleInputChange = useCallback((field) => (e) => {
    setFormData(prev => ({
      ...prev,
      [field]: e.target.value
    }));
  }, [setFormData]);

  const handleGenreToggle = useCallback((genre) => {
    setFormData(prev => {
      const newGenres = prev.genres.includes(genre)
        ? prev.genres.filter(g => g !== genre)
        : [...prev.genres, genre];

      return {
        ...prev,
        genres: newGenres
      };
    });
  }, [setFormData]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{isEditing ? "✏️ Edit Movie" : "➕ Add New Movie"}</h2>

        <form onSubmit={onSave} className="modal-form">
          <div className="form-group">
            <label>Title *</label>
            <input type="text" value={formData.title} onChange={handleInputChange('title')} required />
          </div>

          <div className="form-group">
            <label>Year *</label>
            <input type="number" value={formData.year} onChange={handleInputChange('year')} min="1900" max="2030" required />
          </div>

          <div className="form-group">
            <label>Cast (comma separated)</label>
            <input type="text" value={formData.cast} onChange={handleInputChange('cast')} />
          </div>

          

          <div className="form-group">
            <label>Thumbnail URL (optional)</label>
            <input type="url" value={formData.thumbnail} onChange={handleInputChange('thumbnail')} />
            {formData.thumbnail && (
              <div className="thumbnail-preview">
                <img src={formData.thumbnail} alt="Preview" className="preview-img" onError={(e) => { e.target.style.display = 'none'; }} />
                <span className="preview-fallback">Preview unavailable</span>
              </div>

              
            )}
            
          </div>
          <div className="form-group">
            <label>Genres ({formData.genres.length} selected)</label>
            <div className="modal-genre-grid">
              {allGenres.map(genre => (
                <label key={genre} className="modal-genre-checkbox">
                  <input type="checkbox" checked={formData.genres.includes(genre)} onChange={() => handleGenreToggle(genre)} />
                  <span>{genre}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="modal-actions">
            <button type="submit" className="save-btn">{isEditing ? "💾 Update Movie" : "➕ Add Movie"}</button>
            <button type="button" onClick={onClose} className="cancel-btn">✕ Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
