import express from "express";
import session from "express-session";
import dotenv from "dotenv";
import fetch from "node-fetch";
import SpotifyWebApi from "spotify-web-api-node";

dotenv.config();

const app = express();
const port = process.env.PORT || 8888;

// Configure session middleware
app.use(
	session({
		secret: "your_secret_key", // Replace with a strong, secure key in production
		resave: false,
		saveUninitialized: true,
		cookie: { secure: false }, // Set to true if using HTTPS
	})
);

// Initialize Spotify API client
const spotifyApi = new SpotifyWebApi({
	clientId: process.env.SPOTIFY_CLIENT_ID,
	clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
	redirectUri: process.env.SPOTIFY_REDIRECT_URI,
});

const scopes = ["user-top-read"];

// Home route
app.get("/", (req, res) => {
	res.send(`
    <h1>Spotify Recommendations</h1>
    <a href="/login">Log in with Spotify</a><br />
    <a href="/logout">Logout</a>
  `);
});

// Login route
app.get("/login", (req, res) => {
	const authorizeURL = spotifyApi.createAuthorizeURL(scopes, null);
	res.redirect(authorizeURL);
});

// Callback route
app.get("/callback", async (req, res) => {
	const error = req.query.error;
	const code = req.query.code;

	if (error) {
		console.error("Callback Error:", error);
		res.send(`Callback Error: ${error}`);
		return;
	}

	try {
		const data = await spotifyApi.authorizationCodeGrant(code);
		const access_token = data.body.access_token;
		const refresh_token = data.body.refresh_token;
		const expires_in = data.body.expires_in;

		// Set the access token and refresh token
		spotifyApi.setAccessToken(access_token);
		spotifyApi.setRefreshToken(refresh_token);

		// Store tokens in session
		req.session.access_token = access_token;
		req.session.refresh_token = refresh_token;

		console.log(
			`Successfully retrieved access token. Expires in ${expires_in} s.`
		);
		res.redirect("/recommendations");
	} catch (err) {
		console.error("Error getting Tokens:", err);
		res.send(`Error getting Tokens: ${err}`);
	}
});

// Helper function to fetch Web API
async function fetchWebApi(endpoint, method, token, body) {
	const res = await fetch(`https://api.spotify.com/${endpoint}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		method,
		body: body ? JSON.stringify(body) : null,
	});
	if (!res.ok) {
		console.error(`Error fetching: ${res.status} ${res.statusText}`);
		const text = await res.text();
		console.error(text);
		return {};
	}
	return await res.json();
}

// Helper function to fetch similar tracks from Last.fm
async function getSimilarTracks(trackName, artistName) {
	const apiKey = process.env.LASTFM_API_KEY;
	const response = await fetch(
		`http://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${encodeURIComponent(
			artistName
		)}&track=${encodeURIComponent(trackName)}&api_key=${apiKey}&format=json`
	);
	const data = await response.json();
	if (data.similartracks && data.similartracks.track) {
		return data.similartracks.track.map(
			(track) => `${track.name} by ${track.artist.name}`
		);
	} else {
		return [];
	}
}

// Recommendations route
app.get("/recommendations", async (req, res) => {
	const access_token = req.session.access_token;
	const refresh_token = req.session.refresh_token;

	if (!access_token) {
		res.redirect("/login");
		return;
	}

	spotifyApi.setAccessToken(access_token);
	spotifyApi.setRefreshToken(refresh_token);

	try {
		// Fetch user's top tracks
		const topTracksData = await fetchWebApi(
			"v1/me/top/tracks?time_range=short_term&limit=5",
			"GET",
			access_token
		);
		const topTracks = topTracksData.items;

		console.log(
			topTracks?.map(
				({ name, artists }) =>
					`${name} by ${artists.map((artist) => artist.name).join(", ")}`
			)
		);

		// For each top track, fetch similar tracks
		for (const track of topTracks) {
			const similarTracks = await getSimilarTracks(
				track.name,
				track.artists[0].name
			);
			console.log(
				`Similar tracks to "${track.name}" by ${track.artists[0].name}:`
			);
			console.log(similarTracks);
		}

		res.send(
			"Recommendations have been fetched and logged in the server console."
		);
	} catch (err) {
		console.error("Error fetching recommendations:", err);
		res.send(`Error fetching recommendations: ${err.message}`);
	}
});

// Logout route to clear session
app.get("/logout", (req, res) => {
	req.session.destroy((err) => {
		if (err) {
			console.error("Error destroying session:", err);
		}
		res.redirect("/");
	});
});

// Start the server
app.listen(port, () => {
	console.log(`Server is running on http://localhost:${port}`);
});
