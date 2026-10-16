#ifdef WORKBENCH
//! Exposes the protected forest regeneration to MapGen Workbench plugins.
modded class ForestGeneratorEntity
{
	//------------------------------------------------------------------------------------------------
	void MG_ForceRegenerate()
	{
		RegenerateForest(true);
	}
}
#endif
