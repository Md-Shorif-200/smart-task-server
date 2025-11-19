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
    origin: ["http://localhost:3000", "https://smart-task-iota.vercel.app"]
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
    // await client.connect();

    // !database collection
    const teamsCollection = client.db("SmartTask_Db").collection("Teams");
    const projectCollection = client.db("SmartTask_Db").collection("Projects");
    const tasksCollection = client.db("SmartTask_Db").collection("Tasks");
    const activityLogCollection = client
      .db("SmartTask_Db")
      .collection("ActivityLog");

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
        const { teamId, member_name, role, capacity, currentTasks } = req.body;

        // Generate random member ID
        const randomId = "mem_" + Math.random().toString(36).substring(2, 10);

        const newMember = {
          id: randomId,
          member_name,
          role,
          capacity,
          currentTasks,
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

    // ! task realated api

    app.post("/create-task", async (req, res) => {
      try {
        const taskData = req.body;

        const result = await tasksCollection.insertOne(taskData);

        if (result.insertedId) {
          if (
            taskData.assigned_member &&
            taskData.assigned_member.id !== "Unassigned"
          ) {
            // Update member's currentTasks +1
            const teamId = taskData.team_id;
            const memberId = taskData.assigned_member.id;

            const updateResult = await teamsCollection.updateOne(
              { _id: new ObjectId(teamId), "members.id": memberId },
              { $inc: { "members.$.currentTasks": 1 } }
            );

            console.log(
              "Member currentTasks updated:",
              updateResult.modifiedCount
            );
          }

          res.send({ insertedId: result.insertedId, success: true });
        } else {
          res.status(500).send({ success: false, message: "Task not added!" });
        }
      } catch (error) {
        console.log(error);
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get("/get-all-tasks", async (req, res) => {
      const result = await tasksCollection.find().toArray();

      res.send(result);
    });

    app.delete("/delete-task/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await tasksCollection.deleteOne(query);
      res.send(result);
    });

    app.patch("/update-task/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updatedData = req.body;

        // find old task
        const oldTask = await tasksCollection.findOne({
          _id: new ObjectId(id),
        });

        // update task in DB
        const result = await tasksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );

        // Update team member task counts if assigned member changed
        if (updatedData.assigned_member?.id) {
          const newMember = updatedData.assigned_member.id;
          const oldMember = oldTask.assigned_member?.id;

          // Decrease old member task count
          if (oldMember && oldMember !== "Unassigned") {
            await teamsCollection.updateOne(
              { _id: new ObjectId(oldTask.team_id), "members.id": oldMember },
              { $inc: { "members.$.currentTasks": -1 } }
            );
          }

          // Increase new member task count
          if (newMember !== "Unassigned") {
            await teamsCollection.updateOne(
              { _id: new ObjectId(oldTask.team_id), "members.id": newMember },
              { $inc: { "members.$.currentTasks": 1 } }
            );
          }
        }

        res.send({ success: true, result });
      } catch (error) {
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // ---------

    app.post("/auto-reassign/:teamId", async (req, res) => {
      const teamId = req.params.teamId;

      try {
        // 1. Get team and members
        const team = await teamsCollection.findOne({
          _id: new ObjectId(teamId),
        });
        if (!team)
          return res
            .status(404)
            .send({ success: false, message: "Team not found" });

        const members = team.members;

        // 2. Get all tasks for this team
        const tasks = await tasksCollection.find({ team_id: teamId }).toArray();

        const activityLogs = [];

        // 3. Find overloaded members
        const overloadedMembers = members.filter(
          (member) => member.currentTasks > member.capacity
        );

        // 4. Get underloaded members
        const underloadedMembers = members.filter(
          (member) => member.currentTasks < member.capacity
        );

        if (underloadedMembers.length === 0)
          return res.send({
            success: false,
            message: "No free capacity to reassign tasks",
          });

        for (const member of overloadedMembers) {
          // 5. Get tasks of this member with Low/Medium priority
          const memberTasks = tasks.filter(
            (task) =>
              task.assigned_member?.id === member.id &&
              (task.priority === "Low" || task.priority === "Medium")
          );

          // 6. Calculate extra tasks
          let extra = member.currentTasks - member.capacity;

          for (const task of memberTasks) {
            if (extra <= 0) break;

            // 7. Find a member with free capacity
            const freeMember = underloadedMembers.find(
              (m) => m.currentTasks < m.capacity
            );
            if (!freeMember) break;

            // 8. Reassign task
            await tasksCollection.updateOne(
              { _id: new ObjectId(task._id) },
              {
                $set: {
                  assigned_member: {
                    id: freeMember.id,
                    member_name: freeMember.member_name,
                  },
                },
              }
            );

            // 9. Update members' currentTasks
            await teamsCollection.updateOne(
              { _id: new ObjectId(teamId), "members.id": member.id },
              { $inc: { "members.$.currentTasks": -1 } }
            );

            await teamsCollection.updateOne(
              { _id: new ObjectId(teamId), "members.id": freeMember.id },
              { $inc: { "members.$.currentTasks": 1 } }
            );

            // 10. Record activity log
            activityLogs.push({
              taskId: task._id,
              taskTitle: task.title,
              from: member.member_name,
              to: freeMember.member_name,
              time: new Date(),
            });

            extra--;
          }
        }

        // 11. Optionally, save logs to collection
        if (activityLogs.length > 0) {
          await activityLogCollection.insertMany(activityLogs);
        }

        res.send({
          success: true,
          message: "Tasks reassigned",
          logs: activityLogs,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: error.message });
      }
    });

    app.get("/get-activity-log", async (req, res) => {
      const result = await activityLogCollection.find().toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
