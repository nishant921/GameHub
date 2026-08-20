# 🎮 GameHub

A modern **Free-to-Play Games Discovery Platform** built with **HTML, CSS, and Vanilla JavaScript**.

GameHub lets users explore free-to-play games, search for games, filter them by genre, view detailed information, and maintain a personal library of favorites, wishlist games, and recently viewed games.

Game data is provided by the **[FreeToGame API](https://www.freetogame.com/api-doc)**.

---

## ✨ Features

### 🏠 Home Page

* Featured game hero section
* Trending games
* Popular games
* Genre navigation
* Responsive game cards

### 🔎 Explore Games

* Search games
* Filter by genre
* Filter by rating
* Filter by release year
* Sort games
* Dynamic API-based results

### 🎮 Game Details

Click any game to open a detailed modal containing:

* Game title
* Description
* Genre
* Developer
* Publisher
* Release date
* Platform
* Game image
* Link to the game

### ❤️ Personal Library

GameHub uses browser `localStorage` to maintain:

* Favorites
* Wishlist / Save for Later
* Recently Viewed games

Your library remains available after refreshing the page.

### 📱 Responsive Design

The interface is designed to work across:

* Desktop
* Laptop
* Tablet
* Mobile

### ⚡ API Integration

Game information is loaded dynamically from the FreeToGame API instead of being stored in a static JavaScript array.

The API provides game information including titles, genres, descriptions, developers, publishers, release dates, platforms, thumbnails, and official game links.

---

## 🛠️ Tech Stack

| Technology     | Purpose                                 |
| -------------- | --------------------------------------- |
| HTML5          | Website structure                       |
| CSS3           | Styling and responsive design           |
| JavaScript     | Application logic and DOM manipulation  |
| FreeToGame API | Game data                               |
| Fetch API      | HTTP requests                           |
| LocalStorage   | Favorites, wishlist and recently viewed |
| Git            | Version control                         |
| GitHub         | Repository hosting                      |

---

## 📂 Project Structure

```text
GameHub/
│
├── index.html
├── style.css
├── script.js
├── README.md
└── assets/
    ├── images/
    └── icons/
```

> Your exact asset folders may differ depending on the current project structure.

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/GameHub.git
```

### 2. Open the project

```bash
cd GameHub
```

### 3. Run the project

Because GameHub is a frontend project, you can use a local development server.

For VS Code, the easiest option is **Live Server**.

Open:

```text
index.html
```

with Live Server.

You can also use another local HTTP server if preferred.

---

## 🌐 FreeToGame API

GameHub uses the public **FreeToGame API**.

Base URL:

```text
https://www.freetogame.com/api
```

The API does not require an API key or account. It provides endpoints for retrieving game lists, individual game details, categories, platforms, sorting and filtering.

Example:

```javascript
const response = await fetch(
    "https://www.freetogame.com/api/games"
);

const games = await response.json();
```

### Example Game Details Request

```javascript
const response = await fetch(
    "https://www.freetogame.com/api/game?id=452"
);

const game = await response.json();
```

For the complete API documentation, visit:

**[FreeToGame API Documentation](https://www.freetogame.com/api-doc)**

---

## 🔄 How It Works

```text
User
  │
  ▼
GameHub Frontend
  │
  ├── Search
  ├── Genre Filter
  ├── Sorting
  └── Game Selection
  │
  ▼
JavaScript Fetch API
  │
  ▼
FreeToGame API
  │
  ▼
JSON Game Data
  │
  ▼
normalizeGame()
  │
  ▼
GameHub UI
```

The application converts API responses into a consistent game object before rendering them throughout the website.

---

## 💾 Local Storage

GameHub doesn't require a database for its personal library features.

The browser's `localStorage` is used to store game IDs.

Example storage keys:

```javascript
const STORAGE_KEYS = {
    favorites: "gamehub-favorites",
    wishlist: "gamehub-wishlist",
    recent: "gamehub-recent"
};
```

This allows users to keep their:

* ❤️ Favorite games
* 🔖 Wishlist
* 🕘 Recently viewed games

between page refreshes.

---

## 🔍 Search & Filtering

GameHub supports several ways of discovering games.

### Search

Users can search by game information such as:

* Title
* Description
* Genre
* Developer
* Publisher
* Platform

### Genre

Games can be filtered by genres such as:

* Action
* Adventure
* RPG
* Racing
* Strategy
* Sports
* Horror
* Simulation

### Sorting

Games can be sorted using the available UI options, including:

* Rating
* Release date
* Alphabetical order
* Relevance

---

## ⚠️ API Limitations

Some features of the original GameHub design were designed around RAWG's API. After switching to FreeToGame, certain API-specific capabilities had to be adapted.

FreeToGame does **not expose the same RAWG-style numeric rating system**, so rating-related functionality is handled differently.

FreeToGame also has a different API structure and does not provide the same pagination/trending mechanisms as RAWG.

The project therefore keeps the existing GameHub UI while adapting those features to the data actually provided by FreeToGame.

The FreeToGame API documentation currently recommends avoiding more than **10 requests per second**.

---

## 📜 Attribution

GameHub uses data from **FreeToGame.com**.

FreeToGame's API terms require attribution with an active hyperlink to FreeToGame.com.

**Game data provided by [FreeToGame](https://www.freetogame.com/).**

---

## 🔮 Future Improvements

Possible future upgrades include:

* [ ] User authentication
* [ ] Backend API
* [ ] Database integration
* [ ] User profiles
* [ ] Cloud-synced game libraries
* [ ] Advanced game recommendations
* [ ] Platform-specific filtering
* [ ] Dark/light theme switcher
* [ ] Game comparison
* [ ] Better game discovery algorithm
* [ ] Pagination / infinite scrolling
* [ ] Detailed game pages
* [ ] Game screenshots gallery
* [ ] Minimum system requirements
* [ ] Deployment
* [ ] Progressive Web App support

---

## 📚 What I Learned

This project helped me practice:

* Working with REST APIs
* Using JavaScript `fetch()`
* Handling asynchronous operations with `async/await`
* Working with JSON data
* DOM manipulation
* Event listeners
* Search and filtering
* Client-side sorting
* Browser `localStorage`
* Modal interfaces
* Responsive web design
* Error handling
* API data normalization
* Git and GitHub workflow

---

## 🎯 Project Goal

The goal of GameHub is to create a practical gaming discovery platform while demonstrating real-world frontend development skills.

Instead of relying on hardcoded game data, the application retrieves live game information from an external API and dynamically renders the interface.

---

## 👨‍💻 Author

**Nishant**

Computer Engineering Student

---

## 📄 License

This project is intended for educational and portfolio purposes.

Game data is provided by **FreeToGame.com** and remains subject to its terms of use.

For API terms and usage information, see the **[FreeToGame API Documentation](https://www.freetogame.com/api-doc)**.
