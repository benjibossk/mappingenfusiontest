#ifdef WORKBENCH
//! World Editor tool "MapGen - Camera HUD": prints the viewport camera ("MapGen cam X 3229 Z 1291 cap 274°")
//! top-right of the 3D view, just under the Workbench orientation cube, so screenshots carry it.
//! Screen-space text needs DebugTextFlags.FACE_CAMERA to render (flags 0 = invisible); same pattern as
//! base-game SCR_PrefabBoneSnappingTool / SCR_CompositionValidationEntity.
//! Activate it once from the World Editor tools list; it lives while the tool is active.
//! Refresh: on every mouse / wheel / key event in the viewport (the camera only moves through those)
//! + a 0.5 s call queue tick when the game call queue runs in the editor.
//! WorldEditorTool has no OnUpdate and the script API gives no viewport size: right alignment uses the
//! "Viewport width" property (set it to your 3D view width in px) and an estimated text width.


[WorkbenchToolAttribute(name: "MapGen - Camera HUD", description: "Shows the camera position and heading top-right of the 3D view (for screenshots).\nSet 'Viewport width' to the width of your 3D view in pixels.", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF030)]
class MG_CameraHudTool : WorldEditorTool
{
	//! --- easy to tune ---
	static const float MG_CAMHUD_TOP = 140;		//!< px from the top of the view (orientation cube ~ 120 px)
	static const float MG_CAMHUD_MARGIN_RIGHT = 12;	//!< px from the right edge
	static const float MG_CAMHUD_SIZE = 14;		//!< font size
	static const float MG_CAMHUD_CHAR_W = 0.55;	//!< estimated glyph width / font size (for right alignment)
	static const int MG_CAMHUD_REFRESH_MS = 500;

	[Attribute(defvalue: "1600", desc: "Width of the World Editor 3D view in pixels (right alignment of the text)")]
	protected int m_iViewportWidth;

	protected ref DebugTextScreenSpace m_Text;
	protected bool m_bTicking;

	override void OnActivate()
	{
		m_Text = DebugTextScreenSpace.Create(m_API.GetWorld(), "", DebugTextFlags.FACE_CAMERA, 0, MG_CAMHUD_TOP, MG_CAMHUD_SIZE, 0xFFFFFFFF, 0xA0000000);
		Refresh();
		if (GetGame() && GetGame().GetCallqueue())
		{
			GetGame().GetCallqueue().CallLater(Refresh, MG_CAMHUD_REFRESH_MS, true);
			m_bTicking = true;
		}
	}

	override void OnDeActivate()
	{
		if (m_bTicking && GetGame() && GetGame().GetCallqueue())
			GetGame().GetCallqueue().Remove(Refresh);
		m_bTicking = false;
		m_Text = null;
	}

	override void OnBeforeUnloadWorld()
	{
		m_Text = null;
	}

	override void OnAfterLoadWorld()
	{
		m_Text = DebugTextScreenSpace.Create(m_API.GetWorld(), "", DebugTextFlags.FACE_CAMERA, 0, MG_CAMHUD_TOP, MG_CAMHUD_SIZE, 0xFFFFFFFF, 0xA0000000);
		Refresh();
	}

	override void OnMouseMoveEvent(float x, float y) { Refresh(); }
	override void OnMousePressEvent(float x, float y, WETMouseButtonFlag buttons) { Refresh(); }
	override void OnMouseReleaseEvent(float x, float y, WETMouseButtonFlag buttons) { Refresh(); }
	override void OnWheelEvent(int delta) { Refresh(); }
	override void OnKeyPressEvent(KeyCode key, bool isAutoRepeat) { Refresh(); }
	override void OnKeyReleaseEvent(KeyCode key, bool isAutoRepeat) { Refresh(); }
	override void OnEnterEvent() { Refresh(); }

	void Refresh()
	{
		if (!m_Text || !m_API)
			return;
		BaseWorld world = m_API.GetWorld();
		if (!world)
			return;
		vector camMat[4];
		world.GetCurrentCamera(camMat);
		vector pos = camMat[3];
		vector fwd = camMat[2];
		float yaw = Math.Atan2(fwd[0], fwd[2]) * Math.RAD2DEG; // same convention as MG_GetCamera: 0 = north, clockwise
		if (yaw < 0)
			yaw = yaw + 360;
		string txt = string.Format("MapGen cam X %1 Z %2 cap %3°", Math.Round(pos[0]), Math.Round(pos[2]), Math.Round(yaw));
		m_Text.SetText(txt);
		float w = txt.Length() * MG_CAMHUD_SIZE * MG_CAMHUD_CHAR_W;
		float left = m_iViewportWidth - MG_CAMHUD_MARGIN_RIGHT - w;
		if (left < 0)
			left = 0;
		m_Text.SetPosition(left, MG_CAMHUD_TOP);
	}
}
#endif
