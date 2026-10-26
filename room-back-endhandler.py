import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DATABASE = ROOT / "atelier.db"
SESSION_COOKIE = "atelier_session"


def connect_db():
	connection = sqlite3.connect(DATABASE)
	connection.row_factory = sqlite3.Row
	return connection


def initialize_db():
	with connect_db() as connection:
		connection.executescript(
			"""
			CREATE TABLE IF NOT EXISTS users (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				email TEXT NOT NULL UNIQUE COLLATE NOCASE,
				password_hash TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE TABLE IF NOT EXISTS sessions (
				token_hash TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			CREATE TABLE IF NOT EXISTS projects (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				name TEXT NOT NULL,
				design_json TEXT NOT NULL,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			);
			"""
		)


def hash_password(password, salt=None):
	salt = salt or secrets.token_bytes(16)
	digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
	return f"{salt.hex()}${digest.hex()}"


def verify_password(password, stored_hash):
	salt_hex, digest_hex = stored_hash.split("$", 1)
	candidate = hash_password(password, bytes.fromhex(salt_hex)).split("$", 1)[1]
	return hmac.compare_digest(candidate, digest_hex)


def token_hash(token):
	return hashlib.sha256(token.encode()).hexdigest()


class AtelierHandler(SimpleHTTPRequestHandler):
	server_version = "Atelier/1.0"

	def do_GET(self):
		path = urlparse(self.path).path
		if path.startswith("/api/"):
			self.handle_api_get(path)
			return
		if path == "/atelier.db" or path.startswith("/atelier.db/"):
			self.send_error(HTTPStatus.NOT_FOUND)
			return
		super().do_GET()

	def do_POST(self):
		path = urlparse(self.path).path
		if path.startswith("/api/"):
			self.handle_api_post(path)
			return
		self.send_error(HTTPStatus.NOT_FOUND)

	def do_DELETE(self):
		path = urlparse(self.path).path
		if path.startswith("/api/"):
			self.handle_api_delete(path)
			return
		self.send_error(HTTPStatus.NOT_FOUND)

	def read_json(self):
		try:
			length = int(self.headers.get("Content-Length", "0"))
			return json.loads(self.rfile.read(length) or b"{}")
		except (ValueError, json.JSONDecodeError):
			raise ValueError("Request body must be valid JSON")

	def send_json(self, payload, status=HTTPStatus.OK, headers=None):
		body = json.dumps(payload).encode()
		self.send_response(status)
		self.send_header("Content-Type", "application/json; charset=utf-8")
		self.send_header("Content-Length", str(len(body)))
		self.send_header("Cache-Control", "no-store")
		for key, value in (headers or {}).items():
			self.send_header(key, value)
		self.end_headers()
		self.wfile.write(body)

	def error(self, message, status=HTTPStatus.BAD_REQUEST):
		self.send_json({"error": message}, status)

	def current_user(self):
		cookie = SimpleCookie(self.headers.get("Cookie", ""))
		token = cookie.get(SESSION_COOKIE)
		if not token:
			return None
		with connect_db() as connection:
			return connection.execute(
				"SELECT users.id, users.email FROM users JOIN sessions ON sessions.user_id = users.id WHERE sessions.token_hash = ?",
				(token_hash(token.value),),
			).fetchone()

	def create_session(self, user_id):
		token = secrets.token_urlsafe(32)
		with connect_db() as connection:
			connection.execute("INSERT INTO sessions(token_hash, user_id) VALUES (?, ?)", (token_hash(token), user_id))
		return token

	def session_header(self, token, max_age=60 * 60 * 24 * 30):
		return {"Set-Cookie": f"{SESSION_COOKIE}={token}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax"}

	def handle_api_get(self, path):
		user = self.current_user()
		if path == "/api/session":
			self.send_json({"user": {"email": user["email"]} if user else None})
			return
		if not user:
			self.error("Sign in required", HTTPStatus.UNAUTHORIZED)
			return
		if path == "/api/projects":
			with connect_db() as connection:
				projects = connection.execute(
					"SELECT id, name, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC",
					(user["id"],),
				).fetchall()
			self.send_json({"projects": [dict(project) for project in projects]})
			return
		if path.startswith("/api/projects/"):
			try:
				project_id = int(path.rsplit("/", 1)[1])
			except ValueError:
				self.error("Invalid project id", HTTPStatus.NOT_FOUND)
				return
			with connect_db() as connection:
				project = connection.execute(
					"SELECT id, name, design_json, updated_at FROM projects WHERE id = ? AND user_id = ?",
					(project_id, user["id"]),
				).fetchone()
			if not project:
				self.error("Project not found", HTTPStatus.NOT_FOUND)
				return
			self.send_json({"project": {**dict(project), "design": json.loads(project["design_json"])}})
			return
		self.error("Route not found", HTTPStatus.NOT_FOUND)

	def handle_api_post(self, path):
		try:
			data = self.read_json()
		except ValueError as exception:
			self.error(str(exception))
			return
		if path in ("/api/auth/register", "/api/auth/login"):
			email = str(data.get("email", "")).strip().lower()
			password = str(data.get("password", ""))
			if "@" not in email or len(email) > 180:
				self.error("Enter a valid email address")
				return
			if len(password) < 6:
				self.error("Password must be at least 6 characters")
				return
			with connect_db() as connection:
				user = connection.execute("SELECT id, email, password_hash FROM users WHERE email = ?", (email,)).fetchone()
				if path.endswith("register"):
					if user:
						self.error("An account with that email already exists", HTTPStatus.CONFLICT)
						return
					cursor = connection.execute("INSERT INTO users(email, password_hash) VALUES (?, ?)", (email, hash_password(password)))
					user = {"id": cursor.lastrowid, "email": email}
				elif not user or not verify_password(password, user["password_hash"]):
					self.error("Email or password is incorrect", HTTPStatus.UNAUTHORIZED)
					return
			token = self.create_session(user["id"])
			self.send_json({"user": {"email": user["email"]}}, headers=self.session_header(token))
			return
		user = self.current_user()
		if not user:
			self.error("Sign in required", HTTPStatus.UNAUTHORIZED)
			return
		if path == "/api/auth/logout":
			cookie = SimpleCookie(self.headers.get("Cookie", ""))
			token = cookie.get(SESSION_COOKIE)
			if token:
				with connect_db() as connection:
					connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token.value),))
			self.send_json({"ok": True}, headers=self.session_header("", 0))
			return
		if path == "/api/projects":
			name = str(data.get("name", "Untitled room")).strip()[:120] or "Untitled room"
			design = data.get("design")
			if not isinstance(design, dict):
				self.error("A design payload is required")
				return
			with connect_db() as connection:
				cursor = connection.execute("INSERT INTO projects(user_id, name, design_json) VALUES (?, ?, ?)", (user["id"], name, json.dumps(design)))
			self.send_json({"project": {"id": cursor.lastrowid, "name": name}}, HTTPStatus.CREATED)
			return
		self.error("Route not found", HTTPStatus.NOT_FOUND)

	def handle_api_delete(self, path):
		user = self.current_user()
		if not user:
			self.error("Sign in required", HTTPStatus.UNAUTHORIZED)
			return
		try:
			project_id = int(path.rsplit("/", 1)[1])
		except ValueError:
			self.error("Invalid project id", HTTPStatus.NOT_FOUND)
			return
		with connect_db() as connection:
			connection.execute("DELETE FROM projects WHERE id = ? AND user_id = ?", (project_id, user["id"]))
		self.send_json({"ok": True})

	def log_message(self, format, *args):
		if not self.path.startswith("/api/"):
			super().log_message(format, *args)


if __name__ == "__main__":
	initialize_db()
	port = int(os.environ.get("PORT", "5173"))
	server = ThreadingHTTPServer(("0.0.0.0", port), lambda *args, **kwargs: AtelierHandler(*args, directory=str(ROOT), **kwargs))
	print(f"Atelier running at http://localhost:{port}")
	server.serve_forever()

