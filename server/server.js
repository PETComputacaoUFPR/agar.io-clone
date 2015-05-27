var path = require('path');
var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var users = [];
var foods = [];
var sockets = [];


var maxSizeMass = 100;
var maxMoveSpeed = 100;

var massDecreaseRatio = 10;

var foodMass = 1;
var foodFeedMass = 5;

var newFoodPerPlayer = 10;
var respawnFoodPerPlayer = 1;

var foodRandomWidth = 500;
var foodRandomHeight = 500;
var maxFoodCount = 100;

var noPlayer = 0;

var defaultPlayerSize = 10;

var eatableMassDistance = 5;

app.use(express.static(__dirname + '/../client'));

function genPos(from, to) {
    return Math.floor(Math.random() * to) + from;
}

function addFoods(target) {
    var rx = genPos(0, target.screenWidth);
    var ry = genPos(0, target.screenHeight);
    var food = {
        foodID: (new Date()).getTime(),
        x: rx,
        y: ry,
        color: randomColor()
    };

    foods[foods.length] = food;
}

function generateFood(target) {
    if (foods.length < maxFoodCount) {
        addFoods(target);
    }
}

function findPlayer(id) {
    for (var i = 0; i < users.length; i++) {
        if (users[i].playerID == id) {
            return users[i];
        }
    }

    return null;
}

function findPlayerIndex(id) {
    for (var i = 0; i < users.length; i++) {
        if (users[i].playerID == id) {
            return i;
        }
    }

    return -1;
}

function findFoodIndex(id) {
    for (var i = 0; i < foods.length; i++) {
        if (foods[i].foodID == id) {
            return i;
        }
    }

    return -1;
}

function hitTest(start, end, min) {
    var distance = Math.sqrt((start.x - end.x) * (start.x - end.x) + (start.y - end.y) * (start.y - end.y));
    return (distance <= min);
}

// From SarenCurrie/agar.io-clone
function randomColor(){
    var color = '#' + ('00000'+(Math.random()*(1<<24)|0).toString(16)).slice(-6),
        difference = 32,
        c = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color),
        r = parseInt(c[1], 16) - difference,
        g = parseInt(c[2], 16) - difference,
        b = parseInt(c[3], 16) - difference;

    if (r < 0) {
        r = 0;
    }
    if (g < 0) {
        g = 0;
    }
    if (b < 0) {
        b = 0;
    }

    return {
        fill: color,
        border: '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
    }
}

function movePlayer(player, target) {
    var xVelocity = target.x - player.x,
        yVelocity = target.y - player.y,
        vMag = Math.sqrt(xVelocity * xVelocity + yVelocity * yVelocity),
        normalisedX = xVelocity/vMag,
        normalisedY = yVelocity/vMag,
        finalX = vMag > 25 ? normalisedX * 250 / player.speed : xVelocity * 10 / player.speed,
        finalY = vMag > 25 ? normalisedY * 250 / player.speed : yVelocity * 10 / player.speed;

    player.x += finalX;
    player.y += finalY;
}

io.on('connection', function (socket) {
    console.log('A user connected. Assigning UserID...');

    var userID = socket.id;
    var currentPlayer = {};

    socket.emit("welcome", userID);

    socket.on("gotit", function (player) {
        player.playerID = userID;
        sockets[player.playerID] = socket;

        if (findPlayer(player.playerID) == null) {
            player.color = randomColor();
            console.log("Player " + player.playerID + " connected!");
            users.push(player);
            currentPlayer = player;
        }

        io.emit("playerJoin", {playersList: users, connectedName: player.name});
        console.log("Total player: " + users.length);

        // Add new food when player connected
        for (var i = 0; i < newFoodPerPlayer; i++) {
            generateFood(player);
        }
    });

    socket.on("ping", function () {
        socket.emit("pong");
    });

    socket.on('disconnect', function () {
        var playerIndex = findPlayerIndex(userID);
        var playerName = users[playerIndex].name;
        users.splice(playerIndex, 1);
        console.log('User #' + userID + ' disconnected');
        socket.broadcast.emit("playerDisconnect", {playersList: users, disconnectName: playerName});
    });

    socket.on('respawn', function (player) {
        player.mass = 0;
        player.x = genPos(0, player.screenWidth);
        player.y = genPos(0, player.screenHeight);
    	users.push(player);
    	currentPlayer = player;
    	socket.broadcast.emit("serverUpdateAllPlayers", users);
        console.log('User ' + player.name + ' is back from the deads (as a zombie)');
    });

    socket.on('feed', function (player, target) {
            var index = findPlayerIndex(player.playerID);
            users[index].mass -= foodFeedMass;
            var food = {
                foodID: (new Date()).getTime(),
                x: target.x,
                y: target.y,
                mass: 5,
                color: player.color
            }
            foods[foods.length] = food;
            console.log('User ' + player.name + ' feeded the friends');
    });

    socket.on("playerChat", function (data) {
        var _sender = data.sender.replace(/(<([^>]+)>)/ig, "");
        var _message = data.message.replace(/(<([^>]+)>)/ig, "");
        socket.broadcast.emit("serverSendPlayerChat", {sender: _sender, message: _message});
    });

    // Heartbeat function, update everytime
    socket.on("playerSendTarget", function (target) {
        if (target.x != currentPlayer.x && target.y != currentPlayer.y) {
            movePlayer(currentPlayer, target);

            users[findPlayerIndex(currentPlayer.playerID)] = currentPlayer;

            for (var f = 0; f < foods.length; f++) {
                if (hitTest(
                        {x: foods[f].x, y: foods[f].y},
                        {x: currentPlayer.x, y: currentPlayer.y},
                        currentPlayer.mass + defaultPlayerSize
                    )) {

                    var isFeed = foods[f].mass; // only the food from a feed has mass
                    foods[f] = {};
                    foods.splice(f, 1);

                    if (currentPlayer.mass < maxSizeMass) {
                        if (isFeed)
                            currentPlayer.mass += foodFeedMass;
                        else
                            currentPlayer.mass += foodMass;
                    }

                    if (currentPlayer.speed < maxMoveSpeed) {
                        currentPlayer.speed += currentPlayer.mass / massDecreaseRatio;
                    }

                    console.log("Food eaten");

                    // Respawn food
                    for (var r = 0; r < respawnFoodPerPlayer; r++) {
                        generateFood(currentPlayer);
                    }
                    break;
                }
            }

            for (var e = 0; e < users.length; e++) {
                if (hitTest(
                        {x: users[e].x, y: users[e].y},
                        {x: currentPlayer.x, y: currentPlayer.y},
                        currentPlayer.mass + defaultPlayerSize
                    )) {
                    if (users[e].mass != 0 && users[e].mass < currentPlayer.mass - eatableMassDistance) {
                        if (currentPlayer.mass < maxSizeMass) {
                            currentPlayer.mass += users[e].mass;
                        }

                        if (currentPlayer.speed < maxMoveSpeed) {
                            currentPlayer.speed += currentPlayer.mass / massDecreaseRatio;
                        }

                        sockets[users[e].playerID].emit("respawn");
                        users.splice(e, 1);
                        break;
                    }
                }
            }

            // Do some continuos emit
            socket.emit("serverTellPlayerMove", currentPlayer);
            socket.emit("serverTellPlayerUpdateFoods", foods);
            socket.broadcast.emit("serverUpdateAllPlayers", users);
            socket.broadcast.emit("serverUpdateAllFoods", foods);
        }
    });
});

// Don't touch on ip
var ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || "127.0.0.1";
var serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || 3000;
http.listen( serverport, ipaddress, function() {
    console.log('listening on *:' + serverport);
});
