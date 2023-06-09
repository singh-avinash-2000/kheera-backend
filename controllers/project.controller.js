const asyncHandler = require("express-async-handler");
const Project = require("@models/project");
const User = require("@models/user");
const { sendNotificationToUser } = require("@helpers/notification.helper");
const { sendChatMessageHelper } = require("@helpers/chat.helper");
const { sendProjectNotification } = require("../helpers/notification.helper");
const Chat = require("@models/chat");
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
	service: "gmail",
	auth: {
		user: process.env.EMAIL_ID,
		pass: process.env.EMAIL_PASSWORD
	}
});

exports.fetchProjectListForUser = asyncHandler(async (req, res) =>
{
	const { _id } = req.user;
	const responseObject = {};

	const { searchQuery } = req.query;
	const queryParameters = {
		status: 'ACTIVE',
		members: {
			$elemMatch: {
				user: _id,
				status: 'JOINED'
			}
		}
	};

	if (searchQuery)
	{
		const regex = new RegExp(searchQuery, 'i');
		queryParameters.name = { $regex: regex };
	}

	const records = await Project.find(
		queryParameters,
		{
			"_id": 1,
			"name": 1,
			"role": "$members.role",
			"thumbnail": 1,
		}
	);

	let formattedProjects = records.map(r =>
	{
		return {
			...r._doc,
			role: r._doc.role[0]
		};
	});

	responseObject.message = "Successfully pulled all projects";
	responseObject.result = formattedProjects || [];

	return res.success(responseObject);
});

exports.createNewProject = asyncHandler(async (req, res) =>
{
	const { _id } = req.user;
	const body = req.body;
	const responseObject = {};

	body.members = [
		{
			user: _id,
			role: "OWNER",
			status: "JOINED"
		}
	];

	body.type = body.type.toUpperCase();

	const response = await Project.create(body);
	responseObject.result = {
		name: response.name,
		_id: response._id,
		role: response.members[0].role || "OWNER"
	};

	responseObject.message = "Successfully added a new project";
	return res.success(responseObject);
});

exports.fetchProjectDetails = asyncHandler(async (req, res) =>
{
	const { project_id } = req.params;
	const responseObject = {};

	const record = await Project.findOne({
		_id: project_id
	}).populate("members.user", { "first_name": 1, "last_name": 1, "profile_picture": 1 });

	responseObject.message = "Successfully fetched project details";
	responseObject.result = record;

	return res.success(responseObject);
});

exports.updateProjectDetails = asyncHandler(async (req, res) =>
{
	const { _id } = req.user;
	const { project_id } = req.params;
	const responseObject = {};

	const payload = req.body;

	payload.type = payload.type.toUpperCase();

	const record = await Project.findOneAndUpdate(
		{ _id: project_id },
		payload,
		{ new: true }
	).populate("members.user", { "first_name": 1, "last_name": 1, "profile_picture": 1 });

	responseObject.message = "Successfully updated project details";
	responseObject.result = record;

	return res.success(responseObject);
});

exports.deleteProject = asyncHandler(async (req, res) =>
{
	const { project_id } = req.params;
	const responseObject = {};

	await Project.findOneAndUpdate({ _id: project_id }, { status: "DELETED" });

	responseObject.message = "Successfully deleted project";

	return res.success(responseObject);
});

exports.fetchProjectMembers = asyncHandler(async (req, res) =>
{
	const { _id } = req.user;
	const { project_id } = req.params;
	const responseObject = {};

	const record = await Project.findOne({
		_id: project_id,
		"members.user": _id
	}).populate({ path: "members.user", select: { "_id": 1, "first_name": 1, "last_name": 1, "display_name": 1, "profile_picture": 1 } });


	responseObject.message = "Successfully fetched member details";
	responseObject.result = record.members;

	return res.success(responseObject);
});

exports.addMemberToProject = asyncHandler(async (req, res) =>
{
	const { project_id } = req.params;
	const responseObject = {};
	const body = req.body;
	const projectDetails = req.projects[project_id];

	const userToAdd = await User.findOne({ email: body.email.trim().toLowerCase() });

	if (!userToAdd)
	{
		responseObject.message = "Sorry this user doesn't exist. Please ask them to sign up first.";
		responseObject.code = 404;
		return res.error(responseObject);
	}

	const isAlreadyMember = await Project.findOne({ _id: project_id, "members.user": userToAdd._id });

	if (isAlreadyMember)
	{
		responseObject.message = "User is already a member of this project";
		responseObject.code = 400;
		return res.error(responseObject);
	}

	await Project.findByIdAndUpdate(
		{ _id: project_id },
		{ $push: { members: { user: userToAdd._id, role: body.role || "READ" } } }
	);

	let origin = 'http://localhost:3000';
	if (process.env.NODE_ENV === 'production')
	{
		origin = process.env.CORS_ORIGIN;
	}

	const redirect_url = `${origin}/${req.user.display_name}/${project_id}/invitations`;
	const message = `You are invited to collaborate on ${projectDetails.name}. Please click on the link below to take an action.\n\n ${redirect_url}`;

	const mailOptions = {
		from: process.env.EMAIL_ID,
		to: body.email.trim(),
		subject: "You are invited to collaborate",
		text: message
	};

	transporter.sendMail(mailOptions, async (error, info) =>
	{
		if (error)
		{
			responseObject.code = 500;
			responseObject.message = "Error sending invitation";
			return res.error(responseObject);
		}
		else
		{
			await sendNotificationToUser({
				to: userToAdd._id,
				event: "new-notification",
				payload: {
					message: "You are invited to collaborate",
					is_actionable: true,
					action_title: req.projects[project_id].name + " - " + body.role || "READ",
					redirect_url: `/${req.user.display_name}/${project_id}/invitations`,
					initiator_name: req.user.display_name,
					initiator_profile: req.user.profile_picture
				}
			});

			responseObject.message = "Successfully sent invite to user";
			return res.success(responseObject);
		}
	});
});

exports.removeMemberFromProject = asyncHandler(async (req, res) =>
{
	const { project_id, user_id } = req.params;
	const responseObject = {};

	await Project.findByIdAndUpdate(
		{ _id: project_id },
		{ $pull: { members: { user: user_id } } },
		{ new: true }
	);

	responseObject.message = "Successfully removed member from project";

	return res.success(responseObject);
});

exports.updateProjectMemberDetails = asyncHandler(async (req, res) =>
{
	const { project_id, user_id } = req.params;
	const body = req.body;
	const responseObject = {};

	const updatedProjectDetails = await Project.findOneAndUpdate(
		{ _id: project_id, 'members.user': user_id },
		{ 'members.$.role': body.role },
		{ new: true }
	);

	const userDetails = await User.findById(user_id);

	await sendProjectNotification({
		to: project_id,
		event: "new-notification",
		payload: {
			initiator_name: updatedProjectDetails.name,
			initiator_profile: updatedProjectDetails.thumbnail,
			message: `${userDetails.display_name} now has ${body.role} access.`,
			is_actionable: false,
			redirect_url: `/project/${project_id}/members`
		},
		initiator: req.user._id
	});

	responseObject.message = "Successfully updated member's permission";

	return res.success(responseObject);
});

exports.fetchSearchedProjects = asyncHandler(async (req, res) =>
{
	try
	{
		const { _id } = req.user;
		const { searchQuery } = req.params;
		const responseObject = {};

		if (!searchQuery)
		{
			responseObject.message = "Please provide a search query";
			return res.error(responseObject);
		}

		const regex = new RegExp(searchQuery, 'i');
		const matchedProjects = await Project.find({ name: { $regex: regex }, members: { $elemMatch: { user: _id } } })
			.populate({ path: 'members.user', match: { _id: _id }, select: 'display_name email' });

		const mappedResults = matchedProjects.map(project =>
		{
			const _id = project._doc._id;
			const name = project._doc.name;
			const role = project._doc.members[0].role;
			return {
				_id,
				name,
				role
			};
		});
		responseObject.message = "Successfully fetched searched projects";
		responseObject.result = mappedResults;
		return res.success(responseObject);
	} catch (error)
	{
		console.log(error);
		return res.error(error);
	}

});

exports.invitationAction = asyncHandler(async (req, res) =>
{
	const { _id } = req.user;
	const { project_id } = req.params;

	if (!project_id)
	{
		responseObject.message = "Please provide a project id";
		responseObject.code = 400;
		return res.error(responseObject);
	}

	const body = req.body;
	let responseObject = {};

	const projectDetails = await Project.findOne({ _id: project_id, members: { $elemMatch: { user: _id } } });

	if (!projectDetails)
	{
		responseObject.message = "You are not a member of this project";
		responseObject.code = 400;
		return res.error(responseObject);
	}

	const userStatus = projectDetails.members.find(member => member.user.toString() === _id.toString()).status;
	if (userStatus !== "PENDING")
	{
		responseObject.message = "You have already taken an action on this invitation";
		responseObject.code = 400;
		return res.error(responseObject);
	}

	await Project.findOneAndUpdate(
		{ _id: project_id, 'members.user': _id },
		{ 'members.$.status': body.action },
		{ new: true }
	);

	if (body.action == "JOINED")
	{
		await sendProjectNotification({
			to: project_id,
			event: "new-notification",
			payload: {
				initiator_name: projectDetails.name,
				initiator_profile: projectDetails.thumbnail,
				message: `${req.user.display_name} has now joined`,
				is_actionable: false,
				redirect_url: `/project/${project_id}/members`
			},
			initiator: req.user._id
		});
	}

	responseObject.message = "Successfully updated your status";
	return res.success(responseObject);
});

exports.fetchInvitedProjectDetails = asyncHandler(async (req, res) =>
{
	const { _id } = req.user;
	const { project_id } = req.params;

	if (!project_id)
	{
		responseObject.message = "Please provide a project id";
		responseObject.code = 400;
		return res.error(responseObject);
	}

	const responseObject = {};

	const projectDetails = await Project.findOne({
		_id: project_id
	}).populate("members.user", { "first_name": 1, "last_name": 1, "profile_picture": 1, "display_name": 1, });

	if (!projectDetails)
	{
		responseObject.message = "You are not a invited to this project";
		responseObject.code = 400;
		return res.error(responseObject);
	}

	const userStatus = projectDetails.members.find(member => member.user._id.toString() === _id.toString()).status;
	const invitedRole = projectDetails.members.find(member => member.user._id.toString() === _id.toString()).role;
	if (userStatus !== "PENDING")
	{
		responseObject.message = "You have already taken an action on this invitation";
		responseObject.code = 400;
		return res.error(responseObject);
	}

	responseObject.message = "Successfully fetched project details";

	projectDetails.members = projectDetails.members.filter(member => member.status !== "PENDING");
	projectDetails.members = projectDetails.members.filter(member => member.user.toString() !== _id.toString());
	responseObject.result = {
		name: projectDetails.name,
		description: projectDetails.description,
		role: invitedRole,
		members: projectDetails.members.map(member => ({
			_id: member.user._id,
			display_name: member.user.display_name,
			first_name: member.user.first_name,
			last_name: member.user.last_name,
			profile_picture: member.user.profile_picture,
			role: member.role,
			status: member.status
		}))
	};

	return res.success(responseObject);
});

exports.fetchChatsForProject = asyncHandler(async (req, res) =>
{
	let responseObject = {};
	const { project_id } = req.params;
	const limit = req.query.limit || 10;
	const skip = req.query.skip || 0;

	if (!project_id)
	{
		responseObject.message = "Please provide a project id";
		responseObject.code = 400;
		return res.error(responseObject);
	}
	const { _id } = req.user;
	if (!_id)
	{
		responseObject.message = "Please provide a user id";
		responseObject.code = 400;
		return res.error(responseObject);
	}

	const messages = await Chat.getProjectMessages(project_id, parseInt(limit), parseInt(skip));

	responseObject.message = "Successfully fetched messages";
	responseObject.result = messages;
	responseObject.code = 200;
	return res.success(responseObject);
});

exports.sendChatMessage = asyncHandler(async (req, res) =>
{
	let responseObject = {};
	const { project_id } = req.params;

	if (!project_id)
	{
		responseObject.message = "Please provide a project id";
		responseObject.code = 400;
		return res.error(responseObject);
	}
	const { _id } = req.user;
	if (!_id)
	{
		responseObject.message = "Please provide a user id";
		responseObject.code = 400;
		return res.error(responseObject);
	}

	const { message, type, attachments, sent_at } = req.body;
	let DBresponse = {};
	if (type === 'TEXT')
	{
		DBresponse = await sendChatMessageHelper({
			to: project_id,
			event: 'chat-message',
			payload: {
				type: type,
				message,
				project: project_id,
				project_name: req.projects[project_id].name,
				sent_at: sent_at,
				sender: {
					_id: _id,
					display_name: req.user.display_name,
					profile_picture: req.user.profile_picture,
					email: req.user.email,
				}
			},
			initiator: _id,
			type: type
		});
	}
	else
	{
		DBresponse = await sendChatMessageHelper({
			to: project_id,
			event: 'chat-message',
			payload: {
				type: type,
				document: attachments,
				sent_at: sent_at,
				project: project_id,
				project_name: req.projects[project_id].name,
				sender: {
					_id: _id,
					display_name: req.user.display_name,
					profile_picture: req.user.profile_picture,
					email: req.user.email,
				}
			},
			initiator: _id,
			type: type
		});
	}
	responseObject.message = "Successfully sent message";
	responseObject.code = 200;
	responseObject.result = DBresponse;
	return res.success(responseObject);
});
