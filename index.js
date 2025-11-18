const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 5000;
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// middlewares
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:3000"],
  })
);

// !mongodb link
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.56yvv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    // !database collection
    const teamsCollection = client.db("SmartTask_Db").collection("Teams");
    const projectCollection = client.db("SmartTask_Db").collection("Projects");

    // ! Team Related api

    app.post("/creat-teams", async (req, res) => {
      const data = await req.body;
      console.log(data);

      const result = await teamsCollection.insertOne(data);
      res.send(result);
    });

    app.get("/get-teams", async (req, res) => {
      const result = await teamsCollection.find().toArray();
      res.send(result);
    });

    app.post("/add-team_member", async (req, res) => {
      try {
        const { teamId, member_name, role, capacity } = req.body;

        // Generate random member ID
        const randomId = "mem_" + Math.random().toString(36).substring(2, 10);

        const newMember = {
          id: randomId,
          member_name,
          role,
          capacity,
          date: new Date(),
        };

        const result = await teamsCollection.updateOne(
          { _id: new ObjectId(teamId) },
          { $push: { members: newMember } }
        );

        res.send({ success: true, memberId: randomId, result }); // send random ID back
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ! project related id

    app.post("/add-project", async (req, res) => {
      const data = await req.body;

      const result = await projectCollection.insertOne(data);
      res.send(result);
    });

    app.get("/get-project", async (req, res) => {
      const result = await projectCollection.find().toArray();
      res.send(result);
    });








    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Smart Task server is running");
});

app.listen(port, () => {
  console.log("Smart Task server is running on port", port);
});
