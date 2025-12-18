# NaturalDisasterMonitor-Backend

## Overview
The **NaturalDisasterMonitor-Backend** is a simple backend service designed to support a SwiftUI-based app for reporting natural disasters. It provides a REST API for managing user authentication, disaster reports (CRUD operations), and image uploads. 

The project aims to deliver a straightforward backend solution for handling disaster-related data while ensuring security and scalability.

---

## Features
- **User Authentication**:
  - Secure password hashing using `bcrypt`.
  - Supports user registration and login.

- **Disaster Report Management**:
  - Create, retrieve, update, and delete disaster reports.
  - Reports can include images for better context.

- **Image Upload**:
  - Upload disaster-related images using `multer`.
  - Images are stored locally in the `uploads` folder.

- **Database Handling**:
  - JSON-based database (`db.json`) for storing users and reports.
  - Automatically initializes the database if not present.

---

## Tech Stack
- **Node.js**: Backend runtime.
- **Express.js**: REST API framework.
- **Dependencies**:
  - `bcrypt`: Password security.
  - `uuid`: Generate unique identifiers.
  - `multer`: File upload handling.
  - `cors`: Cross-origin resource sharing support.

---

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/EraserCN/NaturalDisasterMonitor-Backend.git
   ```

2. Navigate into the project directory:
   ```bash
   cd NaturalDisasterMonitor-Backend
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

---

## Usage

### Start the server

Run the following command:
```bash
sudo npm start
```

The server will start on `http://localhost:3000`.

### API Endpoints

#### User Authentication
- **Register**: `POST /api/register`
- **Login**: `POST /login`

#### Disaster Reports
- **Get All Reports**: `GET /api/reports`
- **Create Report**: `POST /api/reports`
- **Update Report**: `PUT /api/reports/:id`
- **Delete Report**: `DELETE /api/reports/:id`

#### Image Upload
- **Upload Image**: `POST /api/upload`

---

## File Structure
```
├── server.js         # Main backend logic
├── db.json           # JSON-based database
├── uploads/          # Directory for uploaded images
├── package.json      # Project configuration
```

---

## Contributing

Feel free to submit pull requests to improve the project. Issues and feature suggestions are welcome!

---

## License

This project is licensed under the ISC License. See the `LICENSE` file for details.

---

## Author

Created by **EraserCN**.
