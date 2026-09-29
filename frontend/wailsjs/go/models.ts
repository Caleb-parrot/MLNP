export namespace main {
	
	export class GameState {
	    Score: number;
	    Lives: number;
	    GameOver: boolean;
	    Won: boolean;
	    Swift: boolean;
	    Frozen: boolean;
	    SwiftMS: number;
	    FrozenMS: number;
	
	    static createFrom(source: any = {}) {
	        return new GameState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Score = source["Score"];
	        this.Lives = source["Lives"];
	        this.GameOver = source["GameOver"];
	        this.Won = source["Won"];
	        this.Swift = source["Swift"];
	        this.Frozen = source["Frozen"];
	        this.SwiftMS = source["SwiftMS"];
	        this.FrozenMS = source["FrozenMS"];
	    }
	}
	export class PlayerUpdate {
	    X: number;
	    Y: number;
	    Dir: number;
	
	    static createFrom(source: any = {}) {
	        return new PlayerUpdate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.X = source["X"];
	        this.Y = source["Y"];
	        this.Dir = source["Dir"];
	    }
	}

}

