#ifdef WORKBENCH
//! Debug access to the prefab generator for MapGen plugins.
modded class PrefabGeneratorEntity
{
	//------------------------------------------------------------------------------------------------
	string MG_DebugState()
	{
		int anchors = -1;
		if (m_ShapeNextPointHelper)
			anchors = m_ShapeNextPointHelper.GetAnchorPoints().Count();

		return string.Format("enable=%1 prefabs=%2 dist=%3 onlyVertices=%4 helperAnchors=%5 genPoints=%6 shape=%7",
			m_bEnableGeneration, m_PrefabNames.Count(), m_fDistance, m_bOnlyToVertices, anchors, m_aPoints.Count(), m_ShapeEntity != null);
	}
}
#endif
