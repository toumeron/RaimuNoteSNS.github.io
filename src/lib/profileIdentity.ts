type Identity = {userId?:string|null;sessionId?:string|null;loading?:boolean;switching?:boolean};
/** Unresolved authentication must never be presented as somebody else's profile. */
export function profileIdentity(profileId:string, auth:Identity) {
  const viewerId=auth.sessionId??auth.userId??null;
  const resolving=!!auth.loading||!!auth.switching||!viewerId||!!(auth.sessionId&&auth.userId&&auth.sessionId!==auth.userId);
  return {viewerId,isMe:!resolving&&viewerId===profileId,canInteract:!resolving&&viewerId!==profileId};
}
