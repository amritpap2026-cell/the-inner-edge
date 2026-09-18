export default function handler(req, res) {
res.status(200).json({
ok: true,
service: "The Inner Edge API",
phase: 2,
message: "Backend is online"
});
}
