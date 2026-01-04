// index.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ObjectId } = require("mongodb");

dotenv.config();

const app = express();

const uri = process.env.MONGO_URI;
const port = process.env.PORT || 8000;

app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());

let client;
let db;
let eventsCollection;
let joinedCollection;
let isDbReady = false;

async function initDb() {
  if (isDbReady) return;

  if (!uri) {
    throw new Error("MONGO_URI is not set in environment variables.");
  }

  client = new MongoClient(uri, {
    serverApi: {
      version: "1",
      strict: true,
      deprecationErrors: true,
    },
  });

  await client.connect();

  db = client.db("social_events");
  eventsCollection = db.collection("events");
  joinedCollection = db.collection("joinedEvents");
  usersCollection = db.collection("users");

  isDbReady = true;
  console.log("✅ Connected to MongoDB");
}

// Ensure DB is ready before handling any route
app.use(async (req, res, next) => {
  try {
    await initDb();
    next();
  } catch (err) {
    console.error("DB init error:", err);
    res.status(500).json({
      ok: false,
      message: "Database initialization failed.",
      error: err.message,
    });
  }
});

// Root
app.get("/", (req, res) => {
  res.send("Social Development Events API is running.");
});

// Statistics endpoint
app.get("/stats", async (req, res) => {
  try {
    const totalEvents = await eventsCollection.estimatedDocumentCount();
    const totalJoined = await joinedCollection.estimatedDocumentCount();
    
    // Get unique user emails using aggregate (API Version 1 compatible)
    const creatorEmailsResult = await eventsCollection.aggregate([
      { $group: { _id: "$creatorEmail" } },
      { $project: { _id: 0, email: "$_id" } }
    ]).toArray();
    
    const participantEmailsResult = await joinedCollection.aggregate([
      { $group: { _id: "$userEmail" } },
      { $project: { _id: 0, email: "$_id" } }
    ]).toArray();
    
    const creatorEmails = creatorEmailsResult.map(r => r.email).filter(Boolean);
    const participantEmails = participantEmailsResult.map(r => r.email).filter(Boolean);
    const allUserEmails = [...new Set([...creatorEmails, ...participantEmails])];
    const totalUsers = allUserEmails.length;

    res.json({
      ok: true,
      totalEvents,
      totalUsers,
      totalJoined,
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to load statistics",
      error: err.message,
    });
  }
});

// ========== USER MANAGEMENT ENDPOINTS ==========

// Get or create user in MongoDB
app.post("/users/sync", async (req, res) => {
  try {
    const { email, displayName, photoURL } = req.body;

    if (!email) {
      return res.status(400).json({
        ok: false,
        message: "Email is required.",
      });
    }

    // Check if user exists
    let user = await usersCollection.findOne({ email });

    if (!user) {
      // Create new user with default role
      const newUser = {
        email,
        displayName: displayName || "",
        photoURL: photoURL || "",
        role: "user", // Default role
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await usersCollection.insertOne(newUser);
      user = { ...newUser, _id: result.insertedId };
    } else {
      // Update existing user info if provided
      const updateData = {
        updatedAt: new Date(),
      };
      if (displayName) updateData.displayName = displayName;
      if (photoURL) updateData.photoURL = photoURL;

      await usersCollection.updateOne(
        { email },
        { $set: updateData }
      );
      user = await usersCollection.findOne({ email });
    }

    res.json({
      ok: true,
      user: {
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Sync user error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to sync user.",
      error: err.message,
    });
  }
});

// Get user by email
app.get("/users/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found.",
      });
    }

    res.json({
      ok: true,
      user: {
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    console.error("Get user error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to get user.",
      error: err.message,
    });
  }
});

// Update user role (Admin only)
app.patch("/users/:email/role", async (req, res) => {
  try {
    const { email } = req.params;
    const { role, requestorEmail } = req.body;

    if (!role || !["user", "admin"].includes(role)) {
      return res.status(400).json({
        ok: false,
        message: "Valid role (user or admin) is required.",
      });
    }

    // Check if requestor is admin
    const requestor = await usersCollection.findOne({ email: requestorEmail });
    if (!requestor || requestor.role !== "admin") {
      return res.status(403).json({
        ok: false,
        message: "Only admins can update user roles.",
      });
    }

    const result = await usersCollection.updateOne(
      { email },
      { $set: { role, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        ok: false,
        message: "User not found.",
      });
    }

    res.json({
      ok: true,
      message: "User role updated successfully.",
    });
  } catch (err) {
    console.error("Update role error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to update user role.",
      error: err.message,
    });
  }
});

// Get all users (Admin only)
app.get("/users", async (req, res) => {
  try {
    const { requestorEmail } = req.query;

    if (!requestorEmail) {
      return res.status(400).json({
        ok: false,
        message: "Requestor email is required.",
      });
    }

    // Check if requestor is admin
    const requestor = await usersCollection.findOne({ email: requestorEmail });
    if (!requestor || requestor.role !== "admin") {
      return res.status(403).json({
        ok: false,
        message: "Only admins can view all users.",
      });
    }

    const users = await usersCollection
      .find({}, { projection: { email: 1, displayName: 1, photoURL: 1, role: 1, createdAt: 1 } })
      .toArray();

    res.json({
      ok: true,
      users,
    });
  } catch (err) {
    console.error("Get all users error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to get users.",
      error: err.message,
    });
  }
});

// Test DB
app.get("/test-db", async (req, res) => {
  try {
    await db.command({ ping: 1 });
    const count = await eventsCollection.estimatedDocumentCount();

    res.json({
      ok: true,
      message: "MongoDB is working",
      totalEvents: count,
    });
  } catch (err) {
    console.error("test-db error:", err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

app.get("/seed-demo-events", async (req, res) => {
  try {
    const now = new Date();
    const addDays = (d) => {
      const date = new Date(now);
      date.setDate(date.getDate() + d);
      return date;
    };

    const demoEvents = [
      {
        title: "City Park Cleanup Drive",
        description:
          "Join us to clean up the city park and make it a cleaner space for everyone. We'll be collecting trash, planting flowers, and beautifying the park area. All volunteers welcome! Bring gloves and water bottles.",
        eventType: "Cleanup",
        thumbnail: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&h=600&fit=crop&q=80",
        location: "City Park, Main Gate, Downtown",
        eventDate: addDays(3),
        creatorEmail: "demo1@example.com",
        createdAt: now,
      },
      {
        title: "Tree Plantation Day",
        description:
          "Plant trees in the community area and help us make the city greener. We'll provide all necessary tools and saplings. Let's work together for a sustainable future! Perfect for families and nature lovers.",
        eventType: "Plantation",
        thumbnail: "https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=800&h=600&fit=crop&q=80",
        location: "Community Ground, Sector 5",
        eventDate: addDays(7),
        creatorEmail: "demo2@example.com",
        createdAt: now,
      },
      {
        title: "Food Donation for Street Children",
        description:
          "Distribute food packs and clothes to underprivileged children. Help us bring smiles to those in need. Your contribution matters! We'll be serving hot meals and distributing essential items.",
        eventType: "Donation",
        thumbnail: "https://images.unsplash.com/photo-1559027615-cd4628902d4a?w=800&h=600&fit=crop&q=80",
        location: "Central Bus Stand Area",
        eventDate: addDays(10),
        creatorEmail: "demo3@example.com",
        createdAt: now,
      },
      {
        title: "Road Safety Awareness Campaign",
        description:
          "Raise awareness about road safety rules among drivers and pedestrians. Educational sessions, demonstrations, and free safety equipment distribution. Learn life-saving road safety tips!",
        eventType: "Awareness",
        thumbnail: "https://images.unsplash.com/photo-1559027615-cd4628902d4a?w=800&h=600&fit=crop&q=80",
        location: "City Square, Near Traffic Signal",
        eventDate: addDays(5),
        creatorEmail: "demo4@example.com",
        createdAt: now,
      },
      {
        title: "Free Health Checkup Camp",
        description:
          "Free basic health checkup and consultation for low-income families. Blood pressure, sugar level, and general health screening available. Qualified doctors and medical professionals will be present.",
        eventType: "Health Camp",
        thumbnail: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1f?w=800&h=600&fit=crop&q=80",
        location: "Community Clinic, Block C",
        eventDate: addDays(14),
        creatorEmail: "demo5@example.com",
        createdAt: now,
      },
      {
        title: "Beach Cleanup Initiative",
        description:
          "Join us for a beach cleanup to protect marine life. We'll collect plastic waste and debris from the shoreline. Bring your friends and family! Help preserve our beautiful coastline.",
        eventType: "Cleanup",
        thumbnail: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop&q=80",
        location: "Sunset Beach, Coastal Road",
        eventDate: addDays(6),
        creatorEmail: "demo1@example.com",
        createdAt: now,
      },
      {
        title: "Community Garden Project",
        description:
          "Help us establish a community garden where neighbors can grow fresh vegetables. Learn gardening techniques and contribute to food security. All skill levels welcome!",
        eventType: "Plantation",
        thumbnail: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&h=600&fit=crop&q=80",
        location: "Community Center, Green Valley",
        eventDate: addDays(9),
        creatorEmail: "demo2@example.com",
        createdAt: now,
      },
      {
        title: "Winter Clothing Drive",
        description:
          "Collect and distribute warm clothing to homeless individuals. Coats, blankets, and winter accessories needed. Let's keep everyone warm this winter! Drop off donations or volunteer to help distribute.",
        eventType: "Donation",
        thumbnail: "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=800&h=600&fit=crop&q=80",
        location: "Community Hall, Main Street",
        eventDate: addDays(12),
        creatorEmail: "demo3@example.com",
        createdAt: now,
      },
      {
        title: "Mental Health Awareness Workshop",
        description:
          "Educational workshop on mental health awareness, stress management, and self-care techniques. Open to all community members. Learn valuable coping strategies and support resources.",
        eventType: "Awareness",
        thumbnail: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&h=600&fit=crop&q=80",
        location: "Community Center, Room 201",
        eventDate: addDays(8),
        creatorEmail: "demo4@example.com",
        createdAt: now,
      },
      {
        title: "Blood Donation Camp",
        description:
          "Organize a blood donation camp in collaboration with local hospital. Your donation can save lives. All donors will receive a certificate and refreshments. Every drop counts!",
        eventType: "Health Camp",
        thumbnail: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&h=600&fit=crop&q=80",
        location: "City Hospital, Ground Floor",
        eventDate: addDays(11),
        creatorEmail: "demo5@example.com",
        createdAt: now,
      },
      {
        title: "Neighborhood Recycling Drive",
        description:
          "Promote recycling in our neighborhood. Collect recyclable materials and educate residents about proper waste management practices. Help create a sustainable community!",
        eventType: "Cleanup",
        thumbnail: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&h=600&fit=crop&q=80",
        location: "Recycling Center, Industrial Area",
        eventDate: addDays(13),
        creatorEmail: "demo1@example.com",
        createdAt: now,
      },
      {
        title: "Educational Support Program",
        description:
          "Provide free tutoring and educational support to underprivileged students. Help shape the future of our community! Volunteers needed for math, science, and language subjects.",
        eventType: "Awareness",
        thumbnail: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&h=600&fit=crop&q=80",
        location: "Public Library, Study Hall",
        eventDate: addDays(15),
        creatorEmail: "demo2@example.com",
        createdAt: now,
      },
      {
        title: "River Cleanup Project",
        description:
          "Help clean up our local river and protect aquatic life. We'll remove trash, debris, and pollutants from the riverbanks. Water safety equipment will be provided.",
        eventType: "Cleanup",
        thumbnail: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&h=600&fit=crop&q=80",
        location: "Riverside Park, North Bridge",
        eventDate: addDays(4),
        creatorEmail: "demo1@example.com",
        createdAt: now,
      },
      {
        title: "Urban Forest Development",
        description:
          "Create an urban forest in the heart of the city. Plant native trees and learn about urban forestry. This project will improve air quality and provide green spaces for future generations.",
        eventType: "Plantation",
        thumbnail: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&h=600&fit=crop&q=80",
        location: "Urban Development Zone, Block 7",
        eventDate: addDays(16),
        creatorEmail: "demo2@example.com",
        createdAt: now,
      },
      {
        title: "Book Donation Drive",
        description:
          "Collect books for underprivileged children and community libraries. Fiction, non-fiction, textbooks, and children's books all welcome. Help spread the joy of reading!",
        eventType: "Donation",
        thumbnail: "https://images.unsplash.com/photo-1481627834876-b7833e03f557?w=800&h=600&fit=crop&q=80",
        location: "Central Library, Main Entrance",
        eventDate: addDays(18),
        creatorEmail: "demo3@example.com",
        createdAt: now,
      },
      {
        title: "Digital Literacy Workshop",
        description:
          "Teach basic computer skills and internet usage to senior citizens and underprivileged youth. Help bridge the digital divide in our community. All equipment provided.",
        eventType: "Awareness",
        thumbnail: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop&q=80",
        location: "Community Tech Center, Floor 2",
        eventDate: addDays(20),
        creatorEmail: "demo4@example.com",
        createdAt: now,
      },
      {
        title: "Eye Care Screening Camp",
        description:
          "Free eye checkup and vision screening for all ages. Glasses distribution for those in need. Professional optometrists will conduct the examinations.",
        eventType: "Health Camp",
        thumbnail: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&h=600&fit=crop&q=80",
        location: "Community Health Center, Main Hall",
        eventDate: addDays(17),
        creatorEmail: "demo5@example.com",
        createdAt: now,
      },
      {
        title: "Plastic-Free Community Initiative",
        description:
          "Launch a campaign to reduce plastic usage in our community. Educational sessions, reusable bag distribution, and plastic collection drive. Let's make our community plastic-free!",
        eventType: "Awareness",
        thumbnail: "https://images.unsplash.com/photo-1621451537084-482c73073a0f?w=800&h=600&fit=crop&q=80",
        location: "Community Plaza, Central Area",
        eventDate: addDays(19),
        creatorEmail: "demo1@example.com",
        createdAt: now,
      },
    ];

    const result = await eventsCollection.insertMany(demoEvents);

    res.json({
      ok: true,
      message: "Demo events inserted successfully.",
      insertedCount: result.insertedCount,
    });
  } catch (err) {
    console.error("Seed demo events error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to seed demo events",
      error: err.message,
    });
  }
});

// --- EVENTS CRUD ---

// Create event
app.post("/events", async (req, res) => {
  try {
    const {
      title,
      description,
      eventType,
      thumbnail,
      location,
      eventDate,
      creatorEmail,
    } = req.body;

    if (
      !title ||
      !description ||
      !eventType ||
      !thumbnail ||
      !location ||
      !eventDate ||
      !creatorEmail
    ) {
      return res.status(400).json({
        ok: false,
        message: "All fields are required.",
      });
    }

    const eventDateObj = new Date(eventDate);
    const now = new Date();

    if (isNaN(eventDateObj.getTime())) {
      return res.status(400).json({
        ok: false,
        message: "Invalid event date.",
      });
    }

    if (eventDateObj <= now) {
      return res.status(400).json({
        ok: false,
        message: "Event date must be a future date.",
      });
    }

    const doc = {
      title,
      description,
      eventType,
      thumbnail,
      location,
      eventDate: eventDateObj,
      creatorEmail,
      createdAt: new Date(),
    };

    const result = await eventsCollection.insertOne(doc);

    res.status(201).json({
      ok: true,
      message: "Event created successfully!",
      eventId: result.insertedId,
    });
  } catch (err) {
    console.error("Create event error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to create event",
      error: err.message,
    });
  }
});

// Get all events
app.get("/events", async (req, res) => {
  try {
    const events = await eventsCollection
      .find({})
      .sort({ eventDate: 1 })
      .toArray();

    res.json({
      ok: true,
      count: events.length,
      events,
    });
  } catch (err) {
    console.error("Get all events error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to load events",
      error: err.message,
    });
  }
});

// Get upcoming events
app.get("/events/upcoming", async (req, res) => {
  try {
    const now = new Date();

    const events = await eventsCollection
      .find({
        eventDate: { $gt: now },
      })
      .sort({ eventDate: 1 })
      .toArray();

    res.json({
      ok: true,
      count: events.length,
      events,
    });
  } catch (err) {
    console.error("Upcoming events error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to load upcoming events",
      error: err.message,
    });
  }
});

// Get events by creator (manage events)
app.get("/events/user", async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) {
      return res.status(400).json({
        ok: false,
        message: "User email is required.",
      });
    }

    const events = await eventsCollection
      .find({ creatorEmail: email })
      .sort({ eventDate: 1 })
      .toArray();

    res.json({
      ok: true,
      count: events.length,
      events,
    });
  } catch (err) {
    console.error("Get user events error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to load user events",
      error: err.message,
    });
  }
});

// Get single event
app.get("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid event id.",
      });
    }

    const event = await eventsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!event) {
      return res.status(404).json({
        ok: false,
        message: "Event not found.",
      });
    }

    res.json({
      ok: true,
      event,
    });
  } catch (err) {
    console.error("Get event details error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to load event details",
      error: err.message,
    });
  }
});

// Update event (only creator)
app.put("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      eventType,
      thumbnail,
      location,
      eventDate,
      requestorEmail,
    } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid event id.",
      });
    }

    if (!requestorEmail) {
      return res.status(400).json({
        ok: false,
        message: "requestorEmail is required.",
      });
    }

    const existing = await eventsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!existing) {
      return res.status(404).json({
        ok: false,
        message: "Event not found.",
      });
    }

    if (existing.creatorEmail !== requestorEmail) {
      return res.status(403).json({
        ok: false,
        message: "You are not allowed to update this event.",
      });
    }

    if (
      !title ||
      !description ||
      !eventType ||
      !thumbnail ||
      !location ||
      !eventDate
    ) {
      return res.status(400).json({
        ok: false,
        message: "All fields are required.",
      });
    }

    const eventDateObj = new Date(eventDate);
    const now = new Date();

    if (isNaN(eventDateObj.getTime())) {
      return res.status(400).json({
        ok: false,
        message: "Invalid event date.",
      });
    }

    if (eventDateObj <= now) {
      return res.status(400).json({
        ok: false,
        message: "Event date must be a future date.",
      });
    }

    const updateDoc = {
      $set: {
        title,
        description,
        eventType,
        thumbnail,
        location,
        eventDate: eventDateObj,
      },
    };

    const result = await eventsCollection.updateOne(
      { _id: new ObjectId(id) },
      updateDoc
    );

    res.json({
      ok: true,
      message: "Event updated successfully.",
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error("Update event error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to update event",
      error: err.message,
    });
  }
});

// --- JOIN EVENT + JOINED EVENTS ---

// Join event
app.post("/join-event", async (req, res) => {
  try {
    const { eventId, userEmail } = req.body;

    if (!eventId || !userEmail) {
      return res.status(400).json({
        ok: false,
        message: "eventId and userEmail are required.",
      });
    }

    if (!ObjectId.isValid(eventId)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid eventId.",
      });
    }

    const event = await eventsCollection.findOne({
      _id: new ObjectId(eventId),
    });

    if (!event) {
      return res.status(404).json({
        ok: false,
        message: "Event not found.",
      });
    }

    const existing = await joinedCollection.findOne({
      eventId: event._id,
      userEmail,
    });

    if (existing) {
      return res.status(400).json({
        ok: false,
        message: "You have already joined this event.",
      });
    }

    const joinDoc = {
      eventId: event._id,
      userEmail,
      joinedAt: new Date(),
      eventTitle: event.title,
      eventType: event.eventType,
      thumbnail: event.thumbnail,
      location: event.location,
      eventDate: event.eventDate,
      creatorEmail: event.creatorEmail,
    };

    const result = await joinedCollection.insertOne(joinDoc);

    res.status(201).json({
      ok: true,
      message: "You have successfully joined this event.",
      joinId: result.insertedId,
    });
  } catch (err) {
    console.error("Join event error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to join event.",
      error: err.message,
    });
  }
});

// Delete event (only creator)
app.delete("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { requestorEmail } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid event id.",
      });
    }

    if (!requestorEmail) {
      return res.status(400).json({
        ok: false,
        message: "requestorEmail is required.",
      });
    }

    const existing = await eventsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!existing) {
      return res.status(404).json({
        ok: false,
        message: "Event not found.",
      });
    }

    if (existing.creatorEmail !== requestorEmail) {
      return res.status(403).json({
        ok: false,
        message: "You are not allowed to delete this event.",
      });
    }

    // Delete the event
    await eventsCollection.deleteOne({ _id: new ObjectId(id) });

    // Also delete related joined events
    await joinedCollection.deleteMany({ eventId: new ObjectId(id) });

    res.json({
      ok: true,
      message: "Event deleted successfully.",
    });
  } catch (err) {
    console.error("Delete event error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to delete event",
      error: err.message,
    });
  }
});

// Joined events for user
app.get("/joined", async (req, res) => {
  try {
    const userEmail = req.query.email;

    if (!userEmail) {
      return res.status(400).json({
        ok: false,
        message: "User email is required.",
      });
    }

    const joinedEvents = await joinedCollection
      .find({ userEmail })
      .sort({ eventDate: 1 })
      .toArray();

    res.json({
      ok: true,
      count: joinedEvents.length,
      joinedEvents,
    });
  } catch (err) {
    console.error("Get joined events error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to load joined events",
      error: err.message,
    });
  }
});

// --- Export for Vercel OR start locally ---

// If running on Vercel, don't listen; just export the app.
if (process.env.VERCEL) {
  module.exports = app;
} else {
  // Local development: node index.js
  app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
  });
}
