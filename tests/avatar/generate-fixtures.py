"""Generate original, tiny loader fixtures; no third-party model downloads."""
from pathlib import Path
import struct,json,zipfile,base64
out=Path(__file__).parent/'fixtures';out.mkdir(exist_ok=True)
p=lambda fmt,*v: struct.pack('<'+fmt,*v)
verts=[(-.5,0,0),(.5,0,0),(0,1.5,0)]
bin=b''.join(p('3f',*v) for v in verts)
base={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[0]}], 'nodes':[{'mesh':0,'rotation':[0,0.38268343,0,0.92387953]}], 'meshes':[{'primitives':[{'attributes':{'POSITION':0},'material':0}]}], 'materials':[{'doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[.3,.8,.6,1],'metallicFactor':0}}], 'buffers':[{'byteLength':len(bin)}], 'bufferViews':[{'buffer':0,'byteLength':len(bin)}], 'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3','min':[-.5,0,0],'max':[.5,1.5,0]}]}
selfcontained=json.loads(json.dumps(base));selfcontained['buffers'][0]['uri']='data:application/octet-stream;base64,'+base64.b64encode(bin).decode()
(out/'embedded.gltf').write_text(json.dumps(selfcontained))
external=json.loads(json.dumps(base));external['buffers'][0]['uri']='../buffers/body.bin'
with zipfile.ZipFile(out/'gltf-package.zip','w',zipfile.ZIP_DEFLATED) as z:
 z.writestr('avatar/model.gltf',json.dumps(external));z.writestr('buffers/body.bin',bin)
(out/'missing.gltf').write_text(json.dumps(external))
obj='v -0.5 0 0\nv 0.5 0 0\nv 0 1.5 0\nf 1 2 3\n'
(out/'triangle.obj').write_text(obj)
with zipfile.ZipFile(out/'obj-package.zip','w',zipfile.ZIP_DEFLATED) as z:
 z.writestr('人物/model.obj','mtllib materials/body.mtl\nusemtl body\n'+obj)
 z.writestr('人物/materials/body.mtl','newmtl body\nKd 0.4 0.8 0.5\nmap_Kd ../../textures/skin.png\n')
 z.writestr('textures/skin.png',base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg=='))
(out/'triangle.fbx').write_text('''; FBX 7.4.0 project file
FBXHeaderExtension:  {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
}
Objects:  {
\tGeometry: 1, "Geometry::Triangle", "Mesh" {
\t\tVertices: *9 {
\t\t\ta: -0.5,0,0,0.5,0,0,0,1.5,0
\t\t}
\t\tPolygonVertexIndex: *3 {
\t\t\ta: 0,1,-3
\t\t}
\t}
\tModel: 2, "Model::Triangle", "Mesh" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",0,35,0
\t\t}
\t}
}
Connections:  {
\tC: "OO",1,2
\tC: "OO",2,0
}
''')
def txt(s):
 b=s.encode('utf-8');return p('i',len(b))+b
bones=[('center',-1,(0,0,0)),('upperbody',0,(0,.7,0)),('neck',1,(0,1.1,0)),('head',2,(0,1.3,0)),('rightarm',1,(-.3,1,0)),('rightelbow',4,(-.6,.9,0))]
b=b'PMX '+p('f',2)+bytes([8,1,0,1,1,1,1,1,1])+txt('Test avatar')+txt('Test avatar')+txt('Original regression fixture')+txt('')
b+=p('i',3)
for v in verts:b+=p('3f3f2fBb f',*v,0,0,1,0,0,0,0,1)
b+=p('i3B',3,0,1,2)+p('i',0)+p('i',1)+txt('body')+txt('body')
b+=p('4f3ff3fB4ffbbBBb',.3,.8,.6,1,0,0,0,0,.1,.1,.1,1,0,0,0,1,0,-1,-1,0,1,0)+txt('')+p('i',3)
b+=p('i',len(bones))
for name,parent,pos in bones:b+=txt(name)+txt(name)+p('3fbiH3f',*pos,parent,0,0x1a,0,.1,0)
b+=p('i',3)
for name in ['あ','まばたき','笑顔']:b+=txt(name)+txt(name)+p('BBiB3f',3,1,1,2,0,-.05,0)
b+=p('3i',0,0,0)
(out/'avatar.pmx').write_bytes(b)
def fixed(s,n):return s.encode('shift_jis')[:n].ljust(n,b'\0')
b=b'Pmd'+p('f',1)+fixed('Test avatar',20)+fixed('Original regression fixture',256)+p('I',3)
for v in verts:b+=p('3f3f2fHHBB',*v,0,0,1,0,0,0,0,100,0)
b+=p('I3H',3,0,1,2)+p('I',1)+p('4ff3f3fbBI',.3,.8,.6,1,0,0,0,0,.1,.1,.1,-1,0,3)+fixed('',20)
b+=p('H',len(bones))
for name,parent,pos in bones:b+=fixed(name,20)+p('hhBh3f',parent,-1,1,0,*pos)
b+=p('HHBBI',0,0,0,0,0)
(out/'avatar.pmd').write_bytes(b)
with zipfile.ZipFile(out/'mmd-package.zip','w',zipfile.ZIP_DEFLATED) as z:z.write(out/'avatar.pmx','日本語/avatar.pmx')
with zipfile.ZipFile(out/'no-model.zip','w') as z:z.writestr('readme.txt','no model')
(out/'broken.glb').write_text('invalid model')
(out/'broken.zip').write_text('not a zip')
