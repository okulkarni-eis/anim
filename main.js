// colors
var gray = "#cccccc";
var grid = "#dddddd";
var grid_guide = "#bbbbbb";
var dark = "#000000";
var light = "#ffffff";

var c;
var ctx;

var animator;
var objs;
var frames;
var menu;
var num_frames = 3;
var frame; // current frame
var next_frame;
var playing;
var onion = false;
var rendering = false;

var t_ease;
var t_steps = 40;

var grid_size = 20;
var menu_time = 0;
var menu_duration = 60;

var tool = "cursor";
var selected;
var new_line;

var mouse_down = false;
var mouse = {x: 0, y: 0};
var mouse_last = {x: 0, y: 0};
var mouse_grid = {x: 0, y: 0};
var mouse_last_grid = {x: 0, y: 0};

window.requestAnimFrame = function() {
    return (
        window.requestAnimationFrame       || 
        window.webkitRequestAnimationFrame || 
        window.mozRequestAnimationFrame    || 
        window.oRequestAnimationFrame      || 
        window.msRequestAnimationFrame     || 
        function(/* function */ callback){
            window.setTimeout(callback, 1000 / 60);
        }
    );
}();

// http://stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
function guid() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
}

function Animator(fps, canvas, frames, callback) {
    this.fps = fps;
    this.canvas = canvas;
    this.frames = frames;
    this.callback = callback;

    if (this.frames > 0) {
        // Create a capturer that exports a WebM video
        this.capturer = new CCapture( { format: 'png', framerate: this.fps } );
        this.capturer.start();
        console.log('Recording');
    }

    this.animate = function () {
        if (this.frames > 0) {
            this.frames -= 1;
            requestAnimationFrame(this.animate);
        } else {
            if (this.capturer) {
                this.capturer.stop();
                this.capturer.save();
                this.capturer = null;
            }

            setTimeout(function() {
                requestAnimationFrame(this.animate);
            }, 1000/this.fps);
        }

        this.callback();
        this.capturer.capture(this.canvas);
    }

    this.animate();
}

function get_mouse_pos(canvas, evt) {
    var rect = canvas.getBoundingClientRect();
    return {
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top
    };
}

function get_mouse_grid_pos() {
    let gs = grid_size / 3;
    return {x: Math.floor((mouse.x + gs/2) / gs) * gs, y: Math.floor((mouse.y + gs/2) / gs) * gs};
}

function distance(a, b) {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function between(a, b) {
    return {x: (a.x + b.x)/2, y: (a.y + b.y)/2};
}

function sigmoid(x, num, offset, width) {
    return num / (1.0 + Math.exp(-(x+offset)*width));
}

function ease_in_out(x) {
    return 1.0 / (1.0 + Math.exp(-(x-.5)*10));
}

function copy(d) {
    return JSON.parse(JSON.stringify(d));
}

function change_frames() {
    for (let i = 0; i < objs.length; i++) {
        obj = objs[i];
        if (obj.properties[next_frame] == null) {
            obj.properties[next_frame] = copy(obj.properties[frame]);
        }
    }
}

function rgbToHex(c) {
    return "#" + ((1 << 24) + (Math.round(c[0]) << 16) + (Math.round(c[1]) << 8) + Math.round(c[2])).toString(16).slice(1);
}

function interpolate(a, b) {
    if (b == null) {
        return a;
    }

    let interp = {};
    for (key in a) {
        if (key == "p") {
            // interpolate position
            let ap = a[key];
            let bp = b[key];

            interp[key] = {x: (1-t_ease) * ap.x + t_ease * bp.x,
                           y: (1-t_ease) * ap.y + t_ease * bp.y};
        } else if (key == "c") {
            // interpolate colors
            let ac = a[key];
            let bc = b[key];
            let ic = [];
            let constrain = Math.min(1, Math.max(0, t_ease));
            for (let i = 0; i < ac.length; i++) {
                ic.push((1-constrain) * ac[i] + constrain * bc[i]);
            }

            interp[key] = ic;
        } else if (key == "path") {
            // interpolate paths
            let ap = a[key];
            let bp = b[key];
            
            ip = [];
            for (let i = 0; i < ap.length; i ++) {
                let newp = {x: (1-t_ease) * ap[i].x + t_ease * bp[i].x,
                            y: (1-t_ease) * ap[i].y + t_ease * bp[i].y};
                ip.push(newp);
            }

            interp[key] = ip;
        } else if (key == "t") {
            if (t_ease < .5) {
                interp[key] = a[key];
            } else {
                interp[key] = b[key];
            }
        } else {
            interp[key] = a[key];
        }
    }

    return interp;
}

function Button(text, pos, callback) {
    this.text = text;
    this.pos = pos;
    this.callback = callback;
    this.radius = 20;
    
    this.hovering = function() {
        return distance(this.pos, mouse) < this.radius;
    }

    this.mouse_click = function(evt) {
        if (this.hovering()) {
            // clicked
            if (this.callback) {
                this.callback(this);
            }
            return true;
        }

        return false;
    }

    this.render = function(ctx) {
        ctx.fillText(this.text, this.pos.x, this.pos.y);
        if (this.hovering()) {
            ctx.fillRect(this.pos.x - this.radius/2, this.pos.y + 10, this.radius, 2);
        }
    }
}

function Shape(color, path) {
    this.type = "Shape";
    this.properties = {};
    this.properties[frame] = {c: color, path: path};

    this.drag_idx = -1;

    this.add_point = function(p) {
        let props = this.properties[frame];
        let path = props.path;
        path.push(p);
    }

    this.closest_point_idx = function() {
        let props = this.properties[frame];
        let path = props.path;
        for (let i = 0; i < path.length; i++) {
            let p = path[i];

            if (distance(p, mouse) < 10) {
                return i;
            }
        }

        return -1;
    }

    this.mouse_down = function(evt) {
        this.drag_idx = this.closest_point_idx();
        if (this.drag_idx != -1) {
            return true;
        }
        
        return false;
    }

    this.mouse_drag = function(evt) {
        let props = this.properties[frame];
        let path = props.path;

        if (this.drag_idx != -1) {
            if (tool == "move") {
                let offset = {x: mouse_grid.x - mouse_grid_last.x,
                          y: mouse_grid.y - mouse_grid_last.y};
                for (let i = 0; i < path.length; i++) {
                    let p = path[i];
                    path[i] = {x: p.x + offset.x, y: p.y + offset.y};
                }
            } else {
                // drag that
                path[this.drag_idx] = {x: mouse_grid.x, y: mouse_grid.y};
            }
        }
    }

    this.mouse_up = function(evt) {
        if (this.drag_idx != -1) {
            if (tool == "del") {
                // delete this
                this.deleted = true;
            } else if (tool == "opaque") {
                this.properties[frame].c = [0, 0, 0, 1];
            } else if (tool == "transparent") {
                this.properties[frame].c = [0, 0, 0, 0];
            }
        }
        
        this.drag_idx = -1;
    }

    this.draw_path = function(path) {
        for (let i = 0; i < path.length; i++) {
            let p = path[i];
            
            if (i == 0) {
                ctx.moveTo(p.x, p.y);
            } else {
                ctx.lineTo(p.x, p.y);
            }
        }
    }

    this.render = function(ctx) {

        let a = this.properties[frame];
        let b = this.properties[next_frame];

        if (onion) {
            let p_before = this.properties[loop_frame(frame-1)];
            if (p_before) {
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = gray;
                this.draw_path(p_before.path);
                ctx.stroke();
                ctx.restore();
            }
        }

        let props = interpolate(a, b);
        var path = props.path;

        ctx.beginPath();
        this.draw_path(path);

        let idx;
        if (this.drag_idx != -1) {
            idx = this.drag_idx;
        } else {
            idx = this.closest_point_idx();
        }

        if (path.length == 1) {
            idx = 0;
        }

        if (idx != -1) {
            let p = path[idx];
            ctx.strokeStyle = dark;
            ctx.strokeRect(p.x - 10, p.y - 10, 20, 20);
        }

        ctx.save();
        ctx.globalAlpha = props.c[3];

        if (props.c[3] == 0 && menu_time > 0) {
            ctx.globalAlpha = .2;
        }

        ctx.strokeStyle = rgbToHex(props.c);
        ctx.stroke();

        if (this.drag_idx != -1) {
            // render side lengths while dragging
            for (let i = 0; i < path.length - 1; i++) {
                let p1 = path[i];
                let p2 = path[i+1];
                let b = between(p1, p2);
                let d = distance(p1, p2) / grid_size;
                d = Math.round(d * 10) / 10;
                ctx.fillText(d, b.x, b.y);
            }
        }

        ctx.restore();
    }
}

function Text(text, pos) {
    this.type = "Text";
    this.properties = {};
    this.properties[frame] = {t: text, p: pos, c: [0, 0, 0, 1]};

    this.dragging = false;
    this.edited = false;

    this.onkeydown = function(evt) {
        let text = this.properties[frame].t;

        if (!this.edited) {
            this.edited = true;
            text = "";
        }

        let key = evt.key;
        if (key == 'Backspace') {
            text = text.slice(0, text.length-1);
        } else if (key.length == 1) {
            text = text + key;
        }

        this.properties[frame].t = text;
    }

    this.mouse_down = function(evt) {
        let pos = this.properties[frame].p;
        if (Math.abs(mouse.x - pos.x) < 20 && Math.abs(mouse.y - pos.y) < 20) {
            this.dragging = true;
            selected = this;
            return true;
        }

        if (selected == this) {
            selected = null;
        }

        return false;
    }

    this.mouse_drag = function(evt) {
        let pos = this.properties[frame].p;
        if (this.dragging) {
            // drag it
            this.properties[frame].p = {x: mouse_grid.x, y: mouse_grid.y};
        }
    }

    this.mouse_up = function(evt) {
        if (this.dragging) {
            if (tool == "del") {
                this.deleted = true;
                if (selected == this) {
                    selected = null;
                }
            } else if (tool == "opaque") {
                this.properties[frame].c = [0, 0, 0, 1];
            } else if (tool == "transparent") {
                this.properties[frame].c = [0, 0, 0, 0];
            }
        }

        this.dragging = false;
    }

    this.render = function(ctx) {

        if (onion) {
            let p_before = this.properties[loop_frame(frame-1)];
            if (p_before) {
                ctx.save();
                ctx.fillStyle = gray;
                ctx.fillText(p_before.t, p_before.p.x, p_before.p.y);
                ctx.restore();
            }
        }

        let a = this.properties[frame];
        let b = this.properties[next_frame];
        let i = interpolate(a, b);

        let pos = i.p;

        ctx.save();
        ctx.globalAlpha = i.c[3];

        if (i.c[3] == 0 && menu_time > 0) {
            ctx.globalAlpha = .2;
        }

        // text change
        if (b && b.c[3] != 0) {
            // if not fading out, but text changing, fade in and out for smoother text change
            if (a.t != b.t ) {
                ctx.globalAlpha = sigmoid(Math.pow(t_ease * 5.0 - 2.5, 2.0), 2.0, 0.0, 1.0) - 1;
            }
        }

        ctx.fillStyle = rgbToHex(i.c);
        ctx.fillText(i.t, pos.x, pos.y);
        ctx.restore();

        if (selected == this) {
            ctx.strokeStyle = dark;
            ctx.strokeRect(pos.x-grid_size, pos.y-grid_size, grid_size*2, grid_size*2);
        }
    }
}

function save(objs) {
    let str = JSON.stringify({"num_frames": num_frames, "objs": objs});
    var blob = new Blob([str], {type: "text/plain;charset=utf-8"});
    let name = document.getElementById("name").value;
    saveAs(blob, name);
}

function load(string) {
    let dict = JSON.parse(string);
    let arr = dict["objs"];

    num_frames = dict["num_frames"];
    frames.create_buttons();

    let newobjs = [];
    for (let i = 0; i < arr.length; i++) {
        let o = arr[i];
        if (o.type == "Shape") {
            let new_shape = new Shape(null, null, null);
            new_shape.properties = o.properties;
            newobjs.push(new_shape);
        } else if (o.type == "Text") {
            let new_txt = new Text(null, null);
            new_txt.properties = o.properties;
            newobjs.push(new_txt);
        }
    }

    return newobjs;
}

function Frames(pos) {
    this.pos = pos;
    this.pad = 8;
    this.size = 32;

    this.frame_pos = function(i) {
        return {x: this.pos.x, y: this.pos.y + (i) * (this.size + this.pad)};
    }

    this.create_buttons = function() {
        this.buttons = [];
        for (let i = 1; i <= num_frames; i++) {
            let newb = new Button(i, this.frame_pos(i), null);
            this.buttons.push(newb);
        }
        this.buttons.push(new Button("-", this.frame_pos(num_frames+1), null));
        this.buttons.push(new Button("+", this.frame_pos(num_frames+2), null));
    };

    this.create_buttons();

    this.mouse_click = function(evt) {
        for (let i = 0; i < this.buttons.length; i++) {
            let btn = this.buttons[i];
            if (btn.mouse_click(evt)) {
                if (i == this.buttons.length - 2) {
                    if (num_frames == 1) {
                        break;
                    }

                    num_frames -= 1;
                    this.create_buttons();
                    break;
                } else if (i == this.buttons.length - 1) {
                    if (num_frames >= 10) {
                        break;
                    }

                    num_frames += 1;
                    this.create_buttons();
                    break;
                } else {
                    this.on_click(i+1);
                }
            }
        }
    }

    this.render = function(ctx) {
        ctx.fillText('frames', this.pos.x, this.pos.y);

        for (let i = 1; i <= this.buttons.length; i++) {
            ctx.strokeStyle = gray;
            if (i == frame) {
                ctx.strokeStyle = dark;
            }
            let rectp = this.frame_pos(i);
            ctx.strokeRect(rectp.x - this.size/2, rectp.y - this.size/2, this.size, this.size);

            let btn = this.buttons[i-1];
            btn.render(ctx);
        }
    }
}

function Menu(pos) {
    this.pos = pos;
    this.buttons = [];

    this.buttons.push(new Button("cursor", {x: 0, y: 0}, function(b) {
        tool = "cursor";
    }));

    this.buttons.push(new Button("move", {x: 0, y: 0}, function(b) {
        tool = "move";
    }));

    this.buttons.push(new Button("text", {x: 0, y: 0}, function(b) {
        tool = "text";
    }));

    this.buttons.push(new Button("shape", {x: 0, y: 0}, function(b) {
        tool = "shape";
    }));

    this.buttons.push(new Button("del", {x: 0, y: 0}, function(b) {
        tool = "del";
    }));

    this.buttons.push(new Button("transparent", {x: 0, y: 0}, function(b) {
        tool = "transparent";
    }));

    this.buttons.push(new Button("opaque", {x: 0, y: 0}, function(b) {
        tool = "opaque";
    }));

    this.buttons.push(new Button("onion", {x: 0, y: 0}, function(b) {
        onion = !onion;
    }));

    this.buttons.push(new Button("render", {x: 0, y: 0}, function(b) {
        // render
        menu_time = 0;
        playing = !playing;
    }));

    this.buttons.push(new Button("save", {x: 0, y: 0}, function(b) {
        save(objs);
    }));

    this.buttons.push(new Button("restore", {x: 0, y: 0}, function(b) {
        let string = save(objs);
        objs = restore(string);
    }));

    for (let i = 0; i < this.buttons.length; i++) {
        let b = this.buttons[i];
        b.pos = {x: this.pos.x, y: this.pos.y + 40 + i * 40};
    }

    this.mouse_click = function(evt) {
        for (let i = 0; i < this.buttons.length; i++) {
            let btn = this.buttons[i];
            if (btn.mouse_click(evt)) {
                return true;
            }
        }

        return false;
    }

    this.render = function(ctx) {
        ctx.fillText("menu", this.pos.x, this.pos.y);

        for (let i = 0; i < this.buttons.length; i++) {
            let b = this.buttons[i];
            b.render(ctx);
            if (b.text == tool) {
                ctx.beginPath();
                ctx.strokeStyle = dark;
                ctx.moveTo(b.pos.x - 10, b.pos.y + 10);
                ctx.lineTo(b.pos.x + 10, b.pos.y + 10);
                ctx.stroke();
            }
        }
    };
}

function Transition() {
    this.steps = 0;
    this.step = 0;
    this.transitioning = false;
    this.target_frame = 0;
    this.complete;

    this.run = function(steps, target_frame, completion) {
        if (this.transitioning) {
            return;
        }

        t_percent = 0.0;
        t_ease = 0.0;
        this.steps = steps;
        this.target_frame = target_frame;
        this.transitioning = true;
        this.completion = completion;
    }

    this.update = function() {
        if (this.transitioning) {
            this.step += 1;
            t_percent = this.step / this.steps;
            t_ease = ease_in_out(t_percent);
            t_ease = sigmoid(t_percent, 1.2, -.4, 14) - sigmoid(t_percent, .2, -.6, 10);
            if (this.step >= this.steps) {
                t_percent = 1.0;
                t_ease = 1.0;
                this.completion(this.target_frame);
                this.step = 0;
                this.transitioning = false;
            }
        }
    }
}

function constrain_frame(f) {
    return Math.max(1, Math.min(num_frames, f));
}

function loop_frame(f) {
    if (f >= num_frames + 1) {
        return 1;
    } else if (f < 1) {
        return num_frames;
    }

    return f;
}

function draw_grid() {
    ctx.strokeStyle = grid;
    // render grid
    let r_num = c.height / grid_size;
    let c_num = c.width / grid_size;
    let x = 0; let y = 0;
    ctx.beginPath();
    for (let i = 0; i < r_num; i++) {
        y = i * grid_size;
        ctx.moveTo(0, y);
        ctx.lineTo(c.width, y);
    }

    for (let j = 0; j < c_num; j++) {
        x = j * grid_size;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, c.height);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = grid_guide;
    ctx.moveTo(mouse_grid.x, 0);
    ctx.lineTo(mouse_grid.x, c.height);
    ctx.moveTo(0, mouse_grid.y);
    ctx.lineTo(c.width, mouse_grid.y);
    ctx.stroke();
}

function transition_with_next(next) {
    new_line = null;
    next_frame = next;
    change_frames();
    transition.run(t_steps, next, function(targ) {
        frame = targ;
    });
}

window.onload = function() {
    
    c = document.createElement("canvas");
    c.width = 1280;
    c.height = 720;

    ctx = c.getContext("2d");
    ctx.fillStyle = dark;
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2;
    ctx.font = "20px Courier";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var content = document.getElementById("content");
    content.appendChild(c);

    document.getElementById("save").onclick = function(evt) {
        save(objs);
        return false;
    };

    document.getElementById("file").onchange = function(evt) {
        let files = evt.target.files; // FileList object
        let f = files[0];

        var reader = new FileReader();

        // Closure to capture the file information.
        reader.onload = (function(theFile) {
            return function(e) {
                objs = load(e.target.result);
            };
        }
        )(f);

        // Read in the image file as a data URL.
        reader.readAsText(f);
    };

    objs = [];

    transition = new Transition();
    frame = 1;
    frames = new Frames({x: 50, y: 50});
    frames.on_click = function(idx) {
        transition_with_next(idx);
    };

    menu = new Menu({x: 150, y: 50});

    window.onkeydown = function(evt) {
        let key = evt.key;

        if (selected != null ) {
            if (typeof selected.onkeydown === 'function') {
                selected.onkeydown(evt);
                return false;
            }
        }

        if (key == " ") {
            return false;
        }

        if (key == "ArrowRight") {
            transition_with_next(loop_frame(frame+1));
            return false;
        } else if (key == "ArrowLeft") {
            transition_with_next(loop_frame(frame-1));
            return false;
        } else if ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].indexOf(Number(key)) != -1) {
            if (!transition.transitioning) {
                transition_with_next(Number(key));
            }
        }
    };
    
    window.onclick = function(evt) {
        frames.mouse_click(evt);

        if (menu.mouse_click(evt)) {
            new_line = null;
            return;
        }

        if (tool == "cursor") {
            for (let i = 0; i < objs.length; i++) {
                let obj = objs[i];
                if (typeof obj.mouse_click === 'function') {
                    obj.mouse_click(evt);
                }
            }
        } else if (tool == "text") {
            // add a num obj at mouse pos
            let n = new Text("0", mouse_grid);
            objs.push(n);
        } else if (tool == "shape") {
            // add a num obj at mouse pos
            if (new_line) {
                // add a point
                new_line.add_point({x: mouse_grid.x, y: mouse_grid.y});
            } else {
                let l = new Shape([0, 0, 0, 1], [{x: mouse_grid.x, y: mouse_grid.y}]);
                objs.push(l);
                new_line = l
            }
        }
    }

    window.onmousedown = function(evt) {
        mouse_down = true;

        for (let i = 0; i < objs.length; i++) {
            let obj = objs[i];
            if (typeof obj.mouse_down === 'function') {
                if (obj.mouse_down(evt)) {
                    break;
                }
            }
        }
    };

    window.onmousemove = function(evt) {
        // update mouse
        mouse = get_mouse_pos(c, evt);
        mouse_grid = get_mouse_grid_pos();

        menu_time = menu_duration;

        if (mouse_down) {
            for (let i = 0; i < objs.length; i++) {
                let obj = objs[i];
                if (typeof obj.mouse_drag === 'function') {
                    obj.mouse_drag(evt);
                }
            }
        }

        mouse_last = get_mouse_pos(c, evt);
        mouse_grid_last = get_mouse_grid_pos();
    };

    window.onmouseup = function(evt) {
        mouse_down = false;

        for (let i = 0; i < objs.length; i++) {
            let obj = objs[i];
            if (typeof obj.mouse_up === 'function') {
                obj.mouse_up(evt);
            }
        }
    }

    var fps = 60;
    animate();
    function animate() {
        setTimeout(function() {
            requestAnimationFrame(animate);
        }, 1000/fps);

        ctx.clearRect(0, 0, c.width, c.height);

        if (menu_time > 0) {
            draw_grid();
            menu_time -= 1;
        }

        for (let i = 0; i < objs.length; i++) {
            let obj = objs[i];
            obj.render(ctx);
        }

        for (let i = objs.length-1; i >= 0; i--) {
            let obj = objs[i];
            if (obj.deleted) {
                objs.splice(i, 1);
            }
        }

        if (menu_time > 0) {
            frames.render(ctx);
            menu.render(ctx);
        }
        
        transition.update();

        if (playing) {
            transition_with_next(loop_frame(frame + 1));
        }
    }
}