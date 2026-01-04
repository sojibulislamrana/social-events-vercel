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
    
    // Get unique user emails from events and joined events
    const creatorEmails = await eventsCollection.distinct("creatorEmail");
    const participantEmails = await joinedCollection.distinct("userEmail");
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
          "Join us to clean up the city park and make it a cleaner space for everyone.",
        eventType: "Cleanup",
        thumbnail: "https://placehold.co/600x400?text=Park+Cleanup",
        location: "City Park, Main Gate",
        eventDate: addDays(3),
        creatorEmail: "demo1@example.com",
        createdAt: now,
      },
      {
        title: "Tree Plantation Day",
        description:
          "Plant trees in the community area and help us make the city greener.",
        eventType: "Plantation",
        thumbnail: "https://placehold.co/600x400?text=Tree+Plantation",
        location: "Community Ground, Sector 5",
        eventDate: addDays(7),
        creatorEmail: "demo2@example.com",
        createdAt: now,
      },
      {
        title: "Food Donation for Street Children",
        description:
          "Distribute food packs and clothes to underprivileged children.",
        eventType: "Donation",
        thumbnail: "https://placehold.co/600x400?text=Food+Donation",
        location: "Central Bus Stand Area",
        eventDate: addDays(10),
        creatorEmail: "demo3@example.com",
        createdAt: now,
      },
      {
        title: "Road Safety Awareness Campaign",
        description:
          "Raise awareness about road safety rules among drivers and pedestrians.",
        eventType: "Awareness",
        thumbnail: "https://placehold.co/600x400?text=Road+Safety",
        location: "City Square, Near Traffic Signal",
        eventDate: addDays(5),
        creatorEmail: "demo4@example.com",
        createdAt: now,
      },
      {
        title: "Free Health Checkup Camp",
        description:
          "Free basic health checkup and consultation for low-income families.",
        eventType: "Health Camp",
        thumbnail: "https://placehold.co/600x400?text=Health+Camp",
        location: "Community Clinic, Block C",
        eventDate: addDays(14),
        creatorEmail: "demo5@example.com",
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
