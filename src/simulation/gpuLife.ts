import type { Camera } from '../rendering/camera.ts';
import { forEachMutation, PackedLife } from './packedLife.ts';

const computeCode = `
struct Params { width:u32, height:u32, stride:u32, birth:u32, survive:u32, pad:u32, pad2:u32, pad3:u32 }
@group(0) @binding(0) var<storage,read> src:array<u32>;
@group(0) @binding(1) var<storage,read_write> dst:array<u32>;
@group(0) @binding(2) var<uniform> p:Params;
fn word(row:u32,x:u32)->u32 { return src[row*p.stride+x]; }
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u) {
 let i=id.x+id.y*16384u; if(i>=p.stride*p.height){return;}
 let x=i%p.stride; let y=i/p.stride;
 let up=(y+p.height-1u)%p.height; let dn=(y+1u)%p.height;
 let l=(x+p.stride-1u)%p.stride; let r=(x+1u)%p.stride;
 let bits=(p.width-1u)%32u+1u;
 let lb=select(31u,bits-1u,x==0u); let rb=select(31u,bits-1u,x==p.stride-1u);
 let a=word(up,x); let b=src[i]; let c=word(dn,x);
 let v0=(a<<1u)|(word(up,l)>>lb); let v1=a; let v2=(a>>1u)|((word(up,r)&1u)<<rb);
 let v3=(b<<1u)|(word(y,l)>>lb); let v4=(b>>1u)|((word(y,r)&1u)<<rb);
 let v5=(c<<1u)|(word(dn,l)>>lb); let v6=c; let v7=(c>>1u)|((word(dn,r)&1u)<<rb);
 let s0=v0^v1; let s1=v2^v3; let s2=v4^v5; let s3=v6^v7;
 let c0=v0&v1; let c1=v2&v3; let c2=v4&v5; let c3=v6&v7;
 let l0=s0^s1; let l1=s2^s3; let t0=s0&s1; let t1=s2&s3;
 let m0=c0^c1^t0; let m1=c2^c3^t1;
 let h0=(c0&c1)|((c0^c1)&t0); let h1=(c2&c3)|((c2^c3)&t1);
 let carry=l0&l1; let lo=l0^l1; let mid=m0^m1^carry;
 let carry2=(m0&m1)|((m0^m1)&carry);
 let hi=h0^h1^carry2; let top=(h0&h1)|((h0^h1)&carry2);
 var result=0u;
 if(p.birth==8u && p.survive==12u) { result=~(hi|top)&mid&(lo|b); }
 else { for(var n=0u;n<=8u;n++) {
  let eq=select(~lo,lo,(n&1u)!=0u)&select(~mid,mid,(n&2u)!=0u)&select(~hi,hi,(n&4u)!=0u)&select(~top,top,(n&8u)!=0u);
  if((p.birth&(1u<<n))!=0u){result|=eq&~b;}
  if((p.survive&(1u<<n))!=0u){result|=eq&b;}
 }}
 if(x==p.stride-1u){result&=0xffffffffu>>(32u-bits);}
 dst[i]=result;
}`;

const renderCode = `
struct View { width:u32,height:u32,stride:u32,pad:u32,camera:vec2f,scale:f32,pad2:f32,viewport:vec2f,pad3:vec2f }
@group(0) @binding(0) var<storage,read> cells:array<u32>;
@group(0) @binding(1) var<uniform> v:View;
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
 let x=f32((i<<1u)&2u);let y=f32(i&2u);return vec4f(x*2.-1.,y*2.-1.,0.,1.);
}
@fragment fn fragment(@builtin(position) pos:vec4f)->@location(0) vec4f {
 let cell=(pos.xy-v.viewport/2.)/v.scale+v.camera;
 let p0=vec2i(floor((floor(pos.xy)-v.viewport/2.)/v.scale+v.camera));
 let p1=vec2i(ceil((floor(pos.xy)+1.-v.viewport/2.)/v.scale+v.camera));
 if(p1.x<=0 || p1.y<=0 || p0.x>=i32(v.width) || p0.y>=i32(v.height)){return vec4f(.09,.125,.165,1.);}
 let start=max(p0,vec2i(0));let end=min(max(p1,start+1),vec2i(i32(v.width),i32(v.height)));
 var alive=0u;
 for(var y=start.y;y<end.y;y++) { for(var w=start.x/32;w<=(end.x-1)/32;w++) {
  let l=u32(max(start.x-w*32,0));let r=u32(min(end.x-w*32,32));
  let mask=(0xffffffffu<<l)&(0xffffffffu>>(32u-r));
  alive|=cells[u32(y)*v.stride+u32(w)]&mask;
 }}
 if(v.scale>=6. && (fract(cell.x)*v.scale<1. || fract(cell.y)*v.scale<1.)){return vec4f(.267,.267,.267,1.);}
 return vec4f(vec3f(select(0.,1.,alive!=0u)),1.);
}`;

export class GpuLife {
    private buffers: GPUBuffer[];
    private params: GPUBuffer;
    private view: GPUBuffer;
    private mutationBuffer: GPUBuffer;
    private compute: GPUComputePipeline;
    private renderPipeline: GPURenderPipeline;
    private mutatePipeline: GPUComputePipeline;
    private mutationCapacity = 0;
    private current = 0;
    private context: GPUCanvasContext;
    private format: GPUTextureFormat;
    private lost = false;
    readonly canvas: OffscreenCanvas;
    readonly device: GPUDevice;
    readonly columns: number;
    readonly rows: number;
    readonly stride: number;

    private constructor(
        device: GPUDevice,
        sim: PackedLife,
        compute: GPUComputePipeline,
        render: GPURenderPipeline,
        mutate: GPUComputePipeline,
        format: GPUTextureFormat,
    ) {
        this.device = device;
        this.columns = sim.columns;
        this.rows = sim.rows;
        this.stride = sim.stride;
        this.compute = compute;
        this.renderPipeline = render;
        this.mutatePipeline = mutate;
        this.buffers = [0, 1].map(() =>
            device.createBuffer({
                size: sim.words.byteLength,
                usage:
                    GPUBufferUsage.STORAGE |
                    GPUBufferUsage.COPY_DST |
                    GPUBufferUsage.COPY_SRC,
            }),
        );
        device.queue.writeBuffer(this.buffers[0], 0, sim.words);
        this.params = device.createBuffer({
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.view = device.createBuffer({
            size: 48,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.mutationBuffer = device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.canvas = new OffscreenCanvas(1, 1);
        const context = this.canvas.getContext('webgpu');
        if (!context) throw new Error('No se pudo crear el canvas WebGPU.');
        this.context = context;
        this.format = format;
        void device.lost.then(() => {
            this.lost = true;
        });
    }
    static async create(sim: PackedLife) {
        if (!navigator.gpu) return null;
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return null;
        if (sim.words.byteLength > adapter.limits.maxStorageBufferBindingSize)
            return null;
        const device = await adapter.requestDevice();
        try {
            const compute = await device.createComputePipelineAsync({
                layout: 'auto',
                compute: {
                    module: device.createShaderModule({ code: computeCode }),
                    entryPoint: 'main',
                },
            });
            const format = navigator.gpu.getPreferredCanvasFormat();
            const module = device.createShaderModule({ code: renderCode });
            const render = await device.createRenderPipelineAsync({
                layout: 'auto',
                vertex: { module, entryPoint: 'vertex' },
                fragment: {
                    module,
                    entryPoint: 'fragment',
                    targets: [{ format }],
                },
                primitive: { topology: 'triangle-list' },
            });
            const mutate = await device.createComputePipelineAsync({
                layout: 'auto',
                compute: {
                    module: device.createShaderModule({
                        code: `
                @group(0) @binding(0) var<storage,read_write> cells:array<atomic<u32>>;
                @group(0) @binding(1) var<storage,read> flips:array<vec2u>;
                @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u) {
                    if(id.x>=arrayLength(&flips)){return;} let f=flips[id.x];atomicXor(&cells[f.x],f.y);
                }`,
                    }),
                    entryPoint: 'main',
                },
            });
            return new GpuLife(device, sim, compute, render, mutate, format);
        } catch (error) {
            device.destroy();
            throw error;
        }
    }
    private check() {
        if (this.lost)
            throw new Error(
                'Se perdió la conexión con la GPU. La simulación se pausó; cargá el último estado guardado.',
            );
    }
    async step(rule: Uint8Array, mutation: boolean) {
        this.check();
        let birth = 0,
            survive = 0;
        for (let i = 0; i < 9; i++) {
            if (rule[i]) birth |= 1 << i;
            if (rule[i + 9]) survive |= 1 << i;
        }
        this.device.queue.writeBuffer(
            this.params,
            0,
            new Uint32Array([
                this.columns,
                this.rows,
                this.stride,
                birth,
                survive,
                0,
                0,
                0,
            ]),
        );
        const encoder = this.device.createCommandEncoder(),
            pass = encoder.beginComputePass();
        pass.setPipeline(this.compute);
        pass.setBindGroup(
            0,
            this.device.createBindGroup({
                layout: this.compute.getBindGroupLayout(0),
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: this.buffers[this.current] },
                    },
                    {
                        binding: 1,
                        resource: { buffer: this.buffers[1 - this.current] },
                    },
                    { binding: 2, resource: { buffer: this.params } },
                ],
            }),
        );
        const groups = Math.ceil((this.stride * this.rows) / 64);
        pass.dispatchWorkgroups(Math.min(256, groups), Math.ceil(groups / 256));
        pass.end();
        this.current = 1 - this.current;
        if (mutation) {
            const flips: number[] = [];
            forEachMutation(this.columns * this.rows, Math.random, (index) => {
                const y = Math.floor(index / this.columns),
                    x = index - y * this.columns;
                flips.push(y * this.stride + (x >>> 5), (1 << (x & 31)) >>> 0);
            });
            if (flips.length) {
                const data = new Uint32Array(flips);
                if (data.byteLength > this.mutationCapacity) {
                    this.mutationBuffer.destroy();
                    this.mutationCapacity = data.byteLength;
                    this.mutationBuffer = this.device.createBuffer({
                        size: data.byteLength,
                        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                    });
                }
                this.device.queue.writeBuffer(this.mutationBuffer, 0, data);
                const mutationPass = encoder.beginComputePass();
                mutationPass.setPipeline(this.mutatePipeline);
                mutationPass.setBindGroup(
                    0,
                    this.device.createBindGroup({
                        layout: this.mutatePipeline.getBindGroupLayout(0),
                        entries: [
                            {
                                binding: 0,
                                resource: {
                                    buffer: this.buffers[this.current],
                                },
                            },
                            {
                                binding: 1,
                                resource: {
                                    buffer: this.mutationBuffer,
                                    size: data.byteLength,
                                },
                            },
                        ],
                    }),
                );
                mutationPass.dispatchWorkgroups(
                    Math.ceil(flips.length / 2 / 64),
                );
                mutationPass.end();
            }
        }
        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();
        this.check();
    }
    async draw(camera: Camera, width: number, height: number) {
        this.check();
        if (this.canvas.width !== width) this.canvas.width = width;
        if (this.canvas.height !== height) this.canvas.height = height;
        // Resizing or exporting the previous bitmap may reset the context.
        // Configure after resizing and before acquiring each frame's texture.
        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: 'opaque',
        });
        const data = new ArrayBuffer(48);
        new Uint32Array(data, 0, 4).set([
            this.columns,
            this.rows,
            this.stride,
            0,
        ]);
        new Float32Array(data, 16, 8).set([
            camera.x,
            camera.y,
            camera.scale,
            0,
            width,
            height,
            0,
            0,
        ]);
        this.device.queue.writeBuffer(this.view, 0, data);
        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: this.context.getCurrentTexture().createView(),
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        });
        pass.setPipeline(this.renderPipeline);
        pass.setBindGroup(
            0,
            this.device.createBindGroup({
                layout: this.renderPipeline.getBindGroupLayout(0),
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: this.buffers[this.current] },
                    },
                    { binding: 1, resource: { buffer: this.view } },
                ],
            }),
        );
        pass.draw(3);
        pass.end();
        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();
        return this.canvas.transferToImageBitmap();
    }
    async download() {
        this.check();
        const size = this.stride * this.rows * 4;
        const staging = this.device.createBuffer({
            size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        try {
            const encoder = this.device.createCommandEncoder();
            encoder.copyBufferToBuffer(
                this.buffers[this.current],
                0,
                staging,
                0,
                size,
            );
            this.device.queue.submit([encoder.finish()]);
            await staging.mapAsync(GPUMapMode.READ);
            return new Uint32Array(staging.getMappedRange().slice(0));
        } finally {
            staging.destroy();
        }
    }
    destroy() {
        this.context.unconfigure();
        for (const b of this.buffers) b.destroy();
        this.params.destroy();
        this.view.destroy();
        this.mutationBuffer.destroy();
        this.device.destroy();
    }
}
